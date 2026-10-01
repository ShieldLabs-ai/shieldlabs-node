import { describe, expect, it } from 'vitest';
import {
  fallbackSlug,
  fromHistoryRow,
  fromWebhookData,
  isTruthy,
  parseHistoryTime,
  parseRfc3339,
  profileFromResponse,
  signalSlug,
  stripWhitespace,
} from '../src/normalize.js';
import type { Identification } from '../src/types.js';
import { loadJson, withoutRaw } from './helpers.js';

interface NormalizationCase {
  name: string;
  source: 'history' | 'webhook';
  input: Record<string, unknown>;
  expected: Omit<Identification, 'raw'>;
}

const normalization = loadJson<{ cases: NormalizationCase[] }>('normalization-cases.json');
const slugs = loadJson<{ cases: { description: string; slug: string }[] }>(
  'signal-slug-cases.json',
);
const edge = loadJson<{
  slug_cases: { description: string; slug: string }[];
  history_time_cases: { input: string; expected: string | null }[];
  rfc3339_cases: { input: string; expected: string | null }[];
  history_rows: {
    name: string;
    input: Record<string, unknown>;
    expected: Omit<Identification, 'raw'>;
  }[];
  webhook_data: {
    name: string;
    input: Record<string, unknown>;
    expected: Omit<Identification, 'raw'>;
  }[];
}>('normalizer-edge-cases.json');

const IDENTIFICATION_KEYS = [
  'request_id',
  'visitor_id',
  'device_id',
  'session_id',
  'cookie_id',
  'user_hid',
  'domain',
  'public_ip',
  'local_ip',
  'connection_type',
  'os',
  'browser',
  'device_type',
  'traffic_source',
  'risk_score',
  'signals',
  'detection_flags',
  'observed_at',
  'source',
  'raw',
];

function normalize(source: 'history' | 'webhook', input: Record<string, unknown>): Identification {
  return source === 'history' ? fromHistoryRow(input) : fromWebhookData(input);
}

describe('normalization-cases.json', () => {
  it('covers both sources', () => {
    const sources = new Set(normalization.cases.map((c) => c.source));
    expect(sources).toEqual(new Set(['history', 'webhook']));
    expect(normalization.cases).toHaveLength(8);
  });

  for (const testCase of normalization.cases) {
    it(`${testCase.name} (${testCase.source})`, () => {
      const result = normalize(testCase.source, testCase.input);
      expect(withoutRaw(result)).toStrictEqual(testCase.expected);
      expect(result.raw).toBe(testCase.input);
      expect(Object.keys(result)).toEqual(IDENTIFICATION_KEYS);
      expect(Object.keys(result.detection_flags)).toHaveLength(19);
    });
  }
});

describe('signal-slug-cases.json', () => {
  for (const { description, slug } of slugs.cases) {
    it(`${JSON.stringify(description)} -> ${slug}`, () => {
      expect(signalSlug(description)).toBe(slug);
    });
  }
});

describe('normalizer-edge-cases.json', () => {
  it.each(edge.slug_cases)('slug of $description', ({ description, slug }) => {
    expect(signalSlug(description)).toBe(slug);
  });

  it.each(edge.history_time_cases)('history time $input', ({ input, expected }) => {
    expect(parseHistoryTime(input)).toBe(expected);
  });

  it.each(edge.rfc3339_cases)('RFC 3339 time $input', ({ input, expected }) => {
    expect(parseRfc3339(input)).toBe(expected);
  });

  it.each(edge.history_rows)('history row $name', ({ input, expected }) => {
    const result = fromHistoryRow(input);
    expect(withoutRaw(result)).toStrictEqual(expected);
    expect(result.raw).toBe(input);
  });

  it.each(edge.webhook_data)('webhook data $name', ({ input, expected }) => {
    const result = fromWebhookData(input);
    expect(withoutRaw(result)).toStrictEqual(expected);
    expect(result.raw).toBe(input);
  });
});

describe('timestamps', () => {
  it.each([
    '2026-02-30 00:00:00',
    '2026-02-29 00:00:00',
    '2026-13-01 00:00:00',
    '2026-00-10 00:00:00',
    '2026-04-31 00:00:00',
    '2026-09-00 00:00:00',
    '2026-09-30 24:00:00',
    '2026-09-30 12:60:00',
    '2026-09-30 12:34:60',
    '0000-01-01 00:00:00',
  ])('rejects the impossible history date %s', (value) => {
    expect(parseHistoryTime(value)).toBeNull();
  });

  it('accepts leap days in leap years only', () => {
    expect(parseHistoryTime('2000-02-29 00:00:00')).toBe('2000-02-29T00:00:00.000Z');
    expect(parseHistoryTime('1900-02-29 00:00:00')).toBeNull();
    expect(parseHistoryTime('2023-02-29 00:00:00')).toBeNull();
  });

  it('returns null when an offset moves the date outside years 1 to 9999', () => {
    expect(parseRfc3339('0001-01-01T00:00:00+01:00')).toBeNull();
    expect(parseRfc3339('9999-12-31T23:30:00-01:00')).toBeNull();
  });

  it('keeps two-digit years as written', () => {
    expect(parseRfc3339('0099-06-15T12:00:00Z')).toBe('0099-06-15T12:00:00.000Z');
  });

  it('returns null for values that are not strings', () => {
    expect(parseHistoryTime(1790771696123)).toBeNull();
    expect(parseHistoryTime(null)).toBeNull();
    expect(parseRfc3339(undefined)).toBeNull();
    expect(parseRfc3339({})).toBeNull();
  });

  it('truncates fractional seconds instead of rounding', () => {
    expect(parseRfc3339('2026-09-30T12:34:56.999999999Z')).toBe('2026-09-30T12:34:56.999Z');
    expect(parseHistoryTime('2026-09-30 12:34:56.0009')).toBe('2026-09-30T12:34:56.000Z');
  });
});

describe('helpers', () => {
  it('trims the shared whitespace set, which differs from String.prototype.trim', () => {
    expect(stripWhitespace('\u001c\u0085 x \u3000')).toBe('x');
    expect(stripWhitespace('\ufeffx')).toBe('\ufeffx');
    expect(stripWhitespace('')).toBe('');
  });

  it('applies the shared truthiness rules', () => {
    expect([null, undefined, false, 0, '', [], {}].map(isTruthy)).toEqual(Array(7).fill(false));
    expect([true, 1, -1, 'x', [0], { a: 0 }, Number.NaN].map(isTruthy)).toEqual(
      Array(7).fill(true),
    );
    expect(isTruthy(() => undefined)).toBe(true);
  });

  it('falls back to "unknown" for empty slugs', () => {
    expect(fallbackSlug('')).toBe('unknown');
    expect(fallbackSlug('___')).toBe('unknown');
  });

  it('never resolves object prototype keys as exact slugs', () => {
    expect(signalSlug('constructor')).toBe('constructor');
    expect(signalSlug('__proto__')).toBe('proto');
  });
});

describe('type guarantees for unexpected input', () => {
  it('turns values of the wrong type into empty strings, 0 weights and NaN scores', () => {
    const result = fromWebhookData({
      request_id: null,
      domain: 42,
      user_hid: 12345,
      risk_score: '80',
      signals: [{ name: null, weight: null }],
      public_ip: 'not an object',
      local_ip: { ip: 7, country: false },
      traffic_source: { channel: ['x'] },
      observed_at: 1790771696123,
    });
    expect(result.request_id).toBe('');
    expect(result.domain).toBe('');
    expect(result.user_hid).toBe('12345');
    expect(result.risk_score).toBeNaN();
    expect(result.signals).toEqual([{ name: '', weight: 0, description: null }]);
    expect(result.public_ip).toEqual({ ip: '', country: '' });
    expect(result.local_ip).toEqual({ ip: '', country: '' });
    expect(result.traffic_source.channel).toBe('');
    expect(result.observed_at).toBeNull();
  });

  it('handles History rows with values of the wrong type', () => {
    const result = fromHistoryRow({
      site_domain: 5,
      domain: 'example.com',
      user_hid: { nested: true },
      score: null,
      score_details: ['already', 'parsed'],
      webrtc_leak_source: 7,
      ip: 12,
      created_at: 0,
    });
    expect(result.domain).toBe('');
    expect(result.user_hid).toBeNull();
    expect(result.risk_score).toBeNaN();
    expect(result.signals).toEqual([]);
    expect(result.public_ip.ip).toBe('');
    expect(result.observed_at).toBeNull();
  });

  it('uses "" for a signal description that is not a string', () => {
    const result = fromHistoryRow({
      score_details: JSON.stringify([{ Value: 10, Description: 42 }]),
    });
    expect(result.signals).toEqual([{ name: 'unknown', weight: 10, description: '' }]);
  });

  it('keeps boolean User HID values as strings', () => {
    expect(fromWebhookData({ user_hid: false }).user_hid).toBe('false');
  });
});

describe('profileFromResponse', () => {
  it('matches management-profile-expected.json and keeps the raw body', () => {
    const body = loadJson<Record<string, unknown>>('management-profile.json');
    const expected = loadJson<Record<string, unknown>>('management-profile-expected.json');
    const profile = profileFromResponse(body);
    const { raw, ...rest } = profile;
    expect(rest).toStrictEqual(expected);
    expect(raw).toBe(body);
    expect(raw.Callback).toBe('');
  });

  it('keeps negative remaining identifications and the zero timestamp', () => {
    const profile = profileFromResponse({
      Domain: 'example.com',
      Weight: -125,
      PublicKey: '',
      Secret: '',
      CreatedAt: '0001-01-01T00:00:00Z',
    });
    expect(profile.remaining_identifications).toBe(-125);
    expect(profile.created_at).toBe('0001-01-01T00:00:00.000Z');
    expect(profile.public_key_masked).toBe('');
  });

  it('defaults missing fields', () => {
    const profile = profileFromResponse({});
    expect(profile).toMatchObject({
      domain: '',
      remaining_identifications: 0,
      public_key_masked: '',
      secret_key_masked: '',
      created_at: null,
    });
  });
});
