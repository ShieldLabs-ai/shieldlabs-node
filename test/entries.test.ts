import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as edge from '../src/edge.js';
import * as node from '../src/index.js';
import { ShieldLabsError, ValidationError } from '../src/index.js';
import { abortReason, detectRuntime, sleep, throwIfAborted, userAgent } from '../src/runtime.js';
import {
  REQUEST_ID,
  TEST_API_KEY,
  fakeFetch,
  historyPage,
  historyRow,
  loadText,
  settle,
} from './helpers.js';

const EXPECTED_EXPORTS = [
  'ApiError',
  'AuthenticationError',
  'BadRequestError',
  'ConnectionError',
  'NIL_UUID',
  'NotFoundError',
  'QuotaExceededError',
  'RISK_BANDS',
  'RateLimitError',
  'SIGNALS',
  'ServerError',
  'ShieldLabs',
  'ShieldLabsError',
  'ShieldLabsManagement',
  'SignatureVerificationError',
  'TimeoutError',
  'VERSION',
  'ValidationError',
  'WebhookParseError',
  'evaluateIdentification',
  'isRateLimited',
  'riskBand',
  'userHid',
  'userHidAsync',
  'webhooks',
];

// HMAC-SHA256(key = "whsec_your_signing_secret", message = "user-42") computed independently.
const KNOWN_USER_HID = createHmac('sha256', 'whsec_your_signing_secret')
  .update('user-42')
  .digest('hex');

describe('public exports', () => {
  it('are identical in the Node entry and the edge entry', () => {
    expect(Object.keys(node).sort()).toEqual(EXPECTED_EXPORTS);
    expect(Object.keys(edge).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it('share the same classes and constants', () => {
    expect(edge.ShieldLabs).toBe(node.ShieldLabs);
    expect(edge.RateLimitError).toBe(node.RateLimitError);
    expect(edge.SIGNALS).toBe(node.SIGNALS);
  });

  it('report the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(node.VERSION).toBe(pkg.version);
    expect(node.VERSION).toBe('1.0.2');
  });

  it('expose frozen webhook helpers', () => {
    expect(Object.isFrozen(node.webhooks)).toBe(true);
    expect(Object.keys(node.webhooks).sort()).toEqual([
      'constructEvent',
      'constructEventAsync',
      'verifySignature',
      'verifySignatureAsync',
    ]);
  });
});

describe('userHid', () => {
  it('returns HMAC-SHA256 of the user ID as 64 lowercase hex characters', () => {
    const hid = node.userHid('user-42', 'whsec_your_signing_secret');
    expect(hid).toBe(KNOWN_USER_HID);
    expect(hid).toMatch(/^[0-9a-f]{64}$/);
    expect(node.userHid('user-42', 'another-secret')).not.toBe(hid);
  });

  it('matches in every entry and flavor', async () => {
    await expect(node.userHidAsync('user-42', 'whsec_your_signing_secret')).resolves.toBe(
      KNOWN_USER_HID,
    );
    await expect(edge.userHidAsync('user-42', 'whsec_your_signing_secret')).resolves.toBe(
      KNOWN_USER_HID,
    );
    await expect(edge.userHidAsync('Jöhn ✓', 'sëcret')).resolves.toBe(
      node.userHid('Jöhn ✓', 'sëcret'),
    );
  });

  it.each([
    ['', 'secret'],
    ['user-42', ''],
    [42, 'secret'],
    ['user-42', undefined],
  ])('rejects userId %j with secret %j', async (userId, secret) => {
    expect(() => node.userHid(userId as string, secret as string)).toThrow(ValidationError);
    await expect(node.userHidAsync(userId as string, secret as string)).rejects.toThrow(
      ValidationError,
    );
    await expect(edge.userHidAsync(userId as string, secret as string)).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('edge entry', () => {
  const body = loadText('webhook-ping.raw.txt');
  const header = 'sha256=ea2685733d254f7028fb031c4214583b0650de01e6c8c93131236024edd9fdd8';
  const secret = 'whsec_00112233445566778899aabbccddeeff';

  it('points synchronous helpers to their Async variants', () => {
    expect(() => edge.webhooks.verifySignature(body, header, secret)).toThrow(ShieldLabsError);
    expect(() => edge.webhooks.verifySignature(body, header, secret)).toThrow(
      /verifySignatureAsync/,
    );
    expect(() => edge.webhooks.constructEvent(body, header, secret)).toThrow(/constructEventAsync/);
    expect(() => edge.userHid('user-42', 'secret')).toThrow(/userHidAsync/);
  });

  it('verifies with WebCrypto', async () => {
    await expect(edge.webhooks.verifySignatureAsync(body, header, secret)).resolves.toBe(true);
    await expect(edge.webhooks.constructEventAsync(body, header, secret)).resolves.toMatchObject({
      event_type: 'webhook.ping',
    });
  });

  it('explains when WebCrypto is missing', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(edge.webhooks.verifySignatureAsync(body, header, secret)).rejects.toThrow(
      /WebCrypto/,
    );
    await expect(edge.userHidAsync('user-42', 'secret')).rejects.toThrow(/WebCrypto/);
  });

  it('runs the same History client', async () => {
    const fake = fakeFetch([historyPage([historyRow(REQUEST_ID)])]);
    const client = new edge.ShieldLabs({ apiKey: TEST_API_KEY, fetch: fake.fetch });
    await expect(client.identifications.get(REQUEST_ID)).resolves.toMatchObject({
      request_id: REQUEST_ID,
    });
  });
});

describe('User-Agent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the SDK, its version and the runtime', () => {
    expect(userAgent()).toBe(`shieldlabs-node/1.0.2 node/${process.versions.node}`);
  });

  it('detects other runtimes', () => {
    vi.stubGlobal('Bun', { version: '1.4.0' });
    expect(detectRuntime()).toBe('bun/1.4.0');
    vi.unstubAllGlobals();
    vi.stubGlobal('Deno', { version: { deno: '2.5.0' } });
    expect(detectRuntime()).toBe('deno/2.5.0');
    vi.unstubAllGlobals();
    vi.stubGlobal('EdgeRuntime', 'edge-runtime');
    expect(detectRuntime()).toBe('edge-runtime');
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    expect(detectRuntime()).toBe('workerd');
    vi.unstubAllGlobals();
    vi.stubGlobal('process', undefined);
    expect(detectRuntime()).toBeNull();
  });
});

describe('runtime helpers', () => {
  it('rejects a sleep that starts with an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already aborted'));
    await expect(sleep(1000, controller.signal)).rejects.toThrow('already aborted');
  });

  it('creates an AbortError when a signal carries no reason', () => {
    const signal = { aborted: true, reason: undefined } as unknown as AbortSignal;
    const reason = abortReason(signal) as Error;
    expect(reason.name).toBe('AbortError');
    expect(() => throwIfAborted(signal)).toThrow('The operation was aborted.');
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });
});

describe('sleep', () => {
  // Longer than the longest delay one timer can take (2 147 483 647 ms, about 24.8 days).
  const LONG_SLEEP_MS = 3_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the given time', async () => {
    const result = settle(sleep(250));
    await vi.advanceTimersByTimeAsync(249);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits the whole time when it is longer than one timer allows', async () => {
    let resolved = false;
    const result = sleep(LONG_SLEEP_MS).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(LONG_SLEEP_MS - 1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(resolved).toBe(true);
  });

  it('rejects with the abort reason during a long wait, after its first timer', async () => {
    const controller = new AbortController();
    const result = settle(sleep(LONG_SLEEP_MS, controller.signal));
    await vi.advanceTimersByTimeAsync(2_500_000_000);
    controller.abort(new Error('stopped waiting'));
    expect(((await result).error as Error).message).toBe('stopped waiting');
    expect(vi.getTimerCount()).toBe(0);
  });
});
