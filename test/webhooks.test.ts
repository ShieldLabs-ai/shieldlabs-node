import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as edge from '../src/edge.js';
import {
  SignatureVerificationError,
  WebhookParseError,
  isRateLimited,
  webhooks,
  type IdentificationScoredEvent,
  type WebhookEvent,
} from '../src/index.js';
import { resetWarnings } from '../src/runtime.js';
import {
  constantTimeEqual,
  parseSignatureHeader,
  payloadBytes,
  secretList,
} from '../src/webhooks.js';
import type { Identification } from '../src/types.js';
import { loadBytes, loadJson, loadText, withoutRaw } from './helpers.js';

interface Vector {
  name: string;
  secret?: string;
  secrets?: string[];
  body: string;
  body_base64: string;
  signature_header: string;
  valid: boolean;
}

const { vectors } = loadJson<{ vectors: Vector[] }>('webhook-signature-vectors.json');
const expectedByName = new Map(
  loadJson<{ cases: { name: string; expected: Omit<Identification, 'raw'> }[] }>(
    'normalization-cases.json',
  ).cases.map((c) => [c.name, c.expected]),
);

const SECRET = 'whsec_00112233445566778899aabbccddeeff';

function sign(body: string | Uint8Array, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function secretOf(vector: Vector): string | string[] {
  return vector.secrets ?? vector.secret ?? '';
}

function bodyBytes(vector: Vector): Uint8Array {
  return new Uint8Array(Buffer.from(vector.body_base64, 'base64'));
}

afterEach(() => resetWarnings());

describe('webhook-signature-vectors.json', () => {
  it('contains 21 vectors with both secret forms', () => {
    expect(vectors).toHaveLength(21);
    expect(vectors.some((v) => Array.isArray(v.secrets))).toBe(true);
    expect(vectors.some((v) => typeof v.secret === 'string')).toBe(true);
    for (const vector of vectors)
      expect(new TextDecoder().decode(bodyBytes(vector))).toBe(vector.body);
  });

  describe.each(vectors)('$name', (vector) => {
    const secret = secretOf(vector);
    const header = vector.signature_header;

    it('verifySignature with the raw bytes, a Buffer, an ArrayBuffer and the string', () => {
      const bytes = bodyBytes(vector);
      expect(webhooks.verifySignature(bytes, header, secret)).toBe(vector.valid);
      expect(webhooks.verifySignature(Buffer.from(bytes), header, secret)).toBe(vector.valid);
      expect(webhooks.verifySignature(bytes.slice().buffer, header, secret)).toBe(vector.valid);
      expect(webhooks.verifySignature(vector.body, header, secret)).toBe(vector.valid);
    });

    it('verifySignatureAsync (Node entry and edge entry)', async () => {
      await expect(webhooks.verifySignatureAsync(bodyBytes(vector), header, secret)).resolves.toBe(
        vector.valid,
      );
      await expect(
        edge.webhooks.verifySignatureAsync(bodyBytes(vector), header, secret),
      ).resolves.toBe(vector.valid);
      await expect(edge.webhooks.verifySignatureAsync(vector.body, header, secret)).resolves.toBe(
        vector.valid,
      );
    });

    it('constructEvent and constructEventAsync', async () => {
      if (vector.valid) {
        const event = webhooks.constructEvent(bodyBytes(vector), header, secret);
        expect(event.event_type).toBe(JSON.parse(vector.body).event_type);
        await expect(
          edge.webhooks.constructEventAsync(vector.body, header, secret),
        ).resolves.toEqual(event);
        await expect(webhooks.constructEventAsync(vector.body, header, secret)).resolves.toEqual(
          event,
        );
      } else {
        expect(() => webhooks.constructEvent(bodyBytes(vector), header, secret)).toThrow(
          SignatureVerificationError,
        );
        await expect(
          edge.webhooks.constructEventAsync(bodyBytes(vector), header, secret),
        ).rejects.toThrow(SignatureVerificationError);
        await expect(
          webhooks.constructEventAsync(bodyBytes(vector), header, secret),
        ).rejects.toThrow(SignatureVerificationError);
      }
    });
  });
});

describe('constructEvent with the webhook fixtures', () => {
  it('parses the scored delivery exactly as sent', () => {
    const raw = loadBytes('webhook-identification-scored.raw.txt');
    const event = webhooks.constructEvent(raw, sign(raw), SECRET) as IdentificationScoredEvent;
    expect(event.event_type).toBe('identification.scored');
    expect(event.schema_version).toBe('2026-06-01');
    expect(event.created_at).toBe('2026-09-30T12:34:57.482913041Z');
    expect(withoutRaw(event.data)).toStrictEqual(expectedByName.get('webhook_scored'));
    expect(event.data.observed_at).toBe('2026-09-30T12:34:57.482Z');
    expect(event.data.traffic_source.landing_url).toBe(
      'https://shop.example.com/signup?utm_source=google&utm_medium=cpc&gclid=abc123',
    );
    expect(event.raw.data).toBe(event.data.raw);
    expect(Object.keys(event)).toEqual([
      'event_type',
      'schema_version',
      'created_at',
      'data',
      'raw',
    ]);
  });

  it('parses the pretty-printed scored fixture to the same identification', () => {
    const pretty = loadText('webhook-identification-scored.json');
    const event = webhooks.constructEvent(
      pretty,
      sign(pretty),
      SECRET,
    ) as IdentificationScoredEvent;
    expect(withoutRaw(event.data)).toStrictEqual(expectedByName.get('webhook_scored'));
  });

  it('parses the rate-limited delivery', () => {
    const body = loadText('webhook-rate-limited.json');
    const event = webhooks.constructEvent(body, sign(body), SECRET) as IdentificationScoredEvent;
    expect(withoutRaw(event.data)).toStrictEqual(expectedByName.get('webhook_rate_limited'));
    expect(isRateLimited(event.data.risk_score)).toBe(true);
    expect(event.data.signals).toEqual([{ name: 'rate_limited', weight: 999, description: null }]);
  });

  it('parses the Verify ping from its exact bytes', () => {
    const raw = loadBytes('webhook-ping.raw.txt');
    const header = vectors.find((v) => v.name === 'valid_real_ping_delivery')?.signature_header;
    const event = webhooks.constructEvent(raw, header, SECRET);
    expect(event).toEqual({
      event_type: 'webhook.ping',
      schema_version: '2026-06-01',
      created_at: '2026-09-30T12:34:56Z',
      raw: loadJson('webhook-ping.json'),
    });
    expect('data' in event).toBe(false);
  });

  it('parses the dashboard test delivery with 17 of 19 flags', () => {
    const body = loadText('webhook-test-delivery.json');
    const sent = JSON.parse(body) as { data: { detection_flags: Record<string, boolean> } };
    expect(Object.keys(sent.data.detection_flags)).toHaveLength(17);
    const event = webhooks.constructEvent(body, sign(body), SECRET) as IdentificationScoredEvent;
    expect(Object.keys(event.data.detection_flags)).toHaveLength(19);
    expect(event.data.detection_flags.browser_automation).toBe(false);
    expect(event.data.detection_flags.search_bot).toBe(false);
    expect(event.data.user_hid).toBeNull();
    expect(event.created_at).toBe('2026-09-30T12:34:56Z');
    expect(event.data.observed_at).toBe('2026-09-30T12:34:56.000Z');
    expect(withoutRaw(event.data)).toStrictEqual(expectedByName.get('webhook_test_delivery'));
  });

  it('narrows the event union by event_type', () => {
    const raw = loadBytes('webhook-identification-scored.raw.txt');
    const event: WebhookEvent = webhooks.constructEvent(raw, sign(raw), SECRET);
    let requestId = '';
    switch (event.event_type) {
      case 'identification.scored':
        requestId = event.data.request_id;
        break;
      case 'webhook.ping':
        break;
      default:
        expect.unreachable();
    }
    expect(requestId).toBe('02f1d973-84db-4156-a7f7-e799e6bf389b');
  });
});

describe('event parsing rules', () => {
  function construct(body: string): WebhookEvent {
    return webhooks.constructEvent(body, sign(body), SECRET);
  }

  it('returns an UnknownWebhookEvent for new event types', () => {
    const body =
      '{"event_type":"identification.refined","schema_version":"2026-06-01","created_at":"2026-09-30T12:00:00Z","data":{"x":1}}';
    const event = construct(body);
    expect(event.event_type).toBe('identification.refined');
    expect(event.raw).toEqual(JSON.parse(body));
    expect('data' in event).toBe(false);
  });

  it('accepts an unknown schema_version and warns once per value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const body =
      '{"event_type":"webhook.ping","schema_version":"2027-01-01","created_at":"2026-09-30T12:00:00Z"}';
    expect(construct(body).schema_version).toBe('2027-01-01');
    construct(body);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('2027-01-01');
    construct('{"event_type":"webhook.ping","created_at":"2026-09-30T12:00:00Z"}');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not warn for the known schema version', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    construct(loadText('webhook-ping.raw.txt'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults missing envelope strings to ""', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const event = construct('{"event_type":"webhook.ping","schema_version":5,"created_at":null}');
    expect(event.schema_version).toBe('');
    expect(event.created_at).toBe('');
  });

  it('strips a byte order mark', () => {
    const body = `\ufeff${loadText('webhook-ping.raw.txt')}`;
    expect(construct(body).event_type).toBe('webhook.ping');
  });

  it.each([
    ['invalid JSON', '{"event_type":'],
    ['an empty body', ''],
    ['a JSON array', '[{"event_type":"webhook.ping"}]'],
    ['a JSON string', '"webhook.ping"'],
    ['a missing event_type', '{"schema_version":"2026-06-01"}'],
    ['an empty event_type', '{"event_type":""}'],
    ['a numeric event_type', '{"event_type":5}'],
    [
      'a scored event without data',
      '{"event_type":"identification.scored","schema_version":"2026-06-01"}',
    ],
    [
      'a scored event with array data',
      '{"event_type":"identification.scored","schema_version":"2026-06-01","data":[]}',
    ],
  ])('throws WebhookParseError for %s', async (_label, body) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => construct(body)).toThrow(WebhookParseError);
    await expect(edge.webhooks.constructEventAsync(body, sign(body), SECRET)).rejects.toThrow(
      WebhookParseError,
    );
  });

  it('verifies before parsing', () => {
    expect(() => webhooks.constructEvent('{"event_type":', sign('something else'), SECRET)).toThrow(
      SignatureVerificationError,
    );
  });
});

describe('signature inputs', () => {
  const body = loadText('webhook-ping.raw.txt');
  const header = sign(body);

  it('accepts a header array with exactly one value', () => {
    expect(webhooks.verifySignature(body, [header], SECRET)).toBe(true);
    expect(webhooks.verifySignature(body, [header, header], SECRET)).toBe(false);
    expect(webhooks.verifySignature(body, [], SECRET)).toBe(false);
  });

  it('returns false for a missing header', () => {
    expect(webhooks.verifySignature(body, null, SECRET)).toBe(false);
    expect(webhooks.verifySignature(body, undefined, SECRET)).toBe(false);
    expect(webhooks.verifySignature(body, 42 as unknown as string, SECRET)).toBe(false);
  });

  it('requires the lowercase sha256= prefix and a 64-digit hex digest', () => {
    expect(webhooks.verifySignature(body, header.replace('sha256=', 'SHA256='), SECRET)).toBe(
      false,
    );
    expect(webhooks.verifySignature(body, header.replace('sha256=', 'sha256= '), SECRET)).toBe(
      false,
    );
    expect(webhooks.verifySignature(body, `${header}00`, SECRET)).toBe(false);
    expect(parseSignatureHeader(`  ${header.toUpperCase().replace('SHA256=', 'sha256=')}\t`)).toBe(
      header.slice(7),
    );
  });

  it('checks every secret in a list and ignores empty entries', () => {
    expect(webhooks.verifySignature(body, header, ['', 'whsec_other', SECRET])).toBe(true);
    expect(webhooks.verifySignature(body, header, ['', ''])).toBe(false);
    expect(webhooks.verifySignature(body, header, [])).toBe(false);
    expect(webhooks.verifySignature(body, header, [42, SECRET] as unknown as string[])).toBe(true);
    expect(secretList(undefined)).toEqual([]);
  });

  it('returns false for a missing secret', () => {
    expect(webhooks.verifySignature(body, header, undefined as unknown as string)).toBe(false);
    expect(() => webhooks.constructEvent(body, header, '')).toThrow(/No webhook signing secret/);
  });

  it('uses the secret with its whsec_ prefix as UTF-8 text', () => {
    const unicodeSecret = 'whsec_тест✓';
    expect(webhooks.verifySignature(body, sign(body, unicodeSecret), unicodeSecret)).toBe(true);
    expect(webhooks.verifySignature(body, sign(body, 'whsec_abc'), 'abc')).toBe(false);
  });

  it('refuses a parsed object and explains why', async () => {
    const parsed = JSON.parse(body) as unknown as string;
    expect(webhooks.verifySignature(parsed, header, SECRET)).toBe(false);
    expect(() => webhooks.constructEvent(parsed, header, SECRET)).toThrow(/raw request body/);
    await expect(edge.webhooks.verifySignatureAsync(parsed, header, SECRET)).resolves.toBe(false);
  });

  it('accepts typed array views with an offset', () => {
    const padded = new Uint8Array(Buffer.from(`xx${body}yy`));
    const view = padded.subarray(2, padded.length - 2);
    expect(webhooks.verifySignature(view, header, SECRET)).toBe(true);
    const dataView = new DataView(padded.buffer, 2, padded.length - 4);
    expect(webhooks.verifySignature(dataView as unknown as Uint8Array, header, SECRET)).toBe(true);
  });

  it('never puts secrets or signatures in error messages', () => {
    try {
      webhooks.constructEvent(body, sign(body, 'whsec_wrong'), SECRET);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(header.slice(7));
      expect(message).not.toContain(sign(body, 'whsec_wrong').slice(7));
    }
  });

  it('exposes byte helpers that behave as documented', () => {
    expect(payloadBytes({})).toBeNull();
    expect(payloadBytes(new ArrayBuffer(2))).toHaveLength(2);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
