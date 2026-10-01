import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sdk from '../src/index.js';
import {
  ApiError,
  AuthenticationError,
  ConnectionError,
  RateLimitError,
  ServerError,
  ShieldLabs,
  ShieldLabsError,
  ShieldLabsManagement,
  TimeoutError,
  ValidationError,
} from '../src/index.js';
import { createApiError, parseRetryAfter } from '../src/http.js';
import {
  REQUEST_ID,
  TEST_API_KEY,
  fakeFetch,
  hangingFetch,
  historyPage,
  jsonResponse,
  loadJson,
  rawResponse,
  settle,
} from './helpers.js';

interface ErrorCase {
  surface: 'history' | 'management';
  status: number;
  content_type: string | null;
  body: string;
  expected_error: string;
  retry: boolean;
}

const errorCases = loadJson<{ cases: ErrorCase[] }>('error-responses.json').cases;
const START = Date.parse('2026-09-30T12:00:00.000Z');

function historyClient(replies: Parameters<typeof fakeFetch>[0], maxRetries = 2) {
  const fake = fakeFetch(replies);
  return { client: new ShieldLabs({ apiKey: TEST_API_KEY, fetch: fake.fetch, maxRetries }), fake };
}

function managementClient(replies: Parameters<typeof fakeFetch>[0], maxRetries = 2) {
  const fake = fakeFetch(replies);
  const client = new ShieldLabsManagement({
    secretKey: '0123456789abcdef0123456789abcdef',
    domain: 'example.com',
    fetch: fake.fetch,
    maxRetries,
  });
  return { client, fake };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('error-responses.json', () => {
  it.each(errorCases)(
    '$surface $status -> $expected_error (retry: $retry)',
    async ({ surface, status, content_type, body, expected_error, retry }) => {
      const response = rawResponse(body, status, content_type);
      const call: { promise: Promise<unknown>; fake: ReturnType<typeof fakeFetch> } =
        surface === 'history'
          ? (() => {
              const { client, fake } = historyClient([response], 1);
              return { promise: client.history.search('request_id', REQUEST_ID), fake };
            })()
          : (() => {
              const { client, fake } = managementClient([response], 1);
              return { promise: client.getProfile(), fake };
            })();
      const result = settle(call.promise);
      await vi.runAllTimersAsync();
      const { error } = await result;
      const ExpectedClass = (sdk as unknown as Record<string, new (...args: never[]) => Error>)[
        expected_error
      ];
      expect(ExpectedClass).toBeDefined();
      expect(error).toBeInstanceOf(ExpectedClass);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(status);
      expect((error as Error).name).toBe(expected_error);
      expect(call.fake.calls).toHaveLength(retry ? 2 : 1);
    },
  );

  it('parses error bodies defensively', () => {
    const headers = new Headers();
    const jsonText = createApiError('History API', 401, '{"error":"invalid api key"}\n', headers);
    expect(jsonText.body).toEqual({ error: 'invalid api key' });
    expect(jsonText.message).toContain('invalid api key');

    const bareString = createApiError('Management API', 400, '"fail parse uuid"', headers);
    expect(bareString.body).toBe('fail parse uuid');
    expect(bareString.message).toContain('fail parse uuid');

    const nullBody = createApiError('Management API', 400, 'null', headers);
    expect(nullBody.body).toBeNull();

    const emptyBody = createApiError('Management API', 401, '', headers);
    expect(emptyBody.body).toBeNull();
    expect(emptyBody.message).toMatch(/HTTP 401\./);

    const plain = createApiError('History API', 404, '404 page not found', headers);
    expect(plain.body).toBe('404 page not found');
    expect(plain.message).toContain('404 page not found');
    expect(plain.message).toContain('Check the base URL');

    const html = createApiError(
      'History API',
      502,
      '<html><body><h1>502 Bad Gateway</h1></body></html>',
      headers,
    );
    expect(html.body).toContain('<html>');
    expect(html.message).not.toContain('<');

    const longText = createApiError('History API', 500, 'x'.repeat(500), headers);
    expect(longText.message.length).toBeLessThan(300);

    const objectWithoutError = createApiError('History API', 500, '{"message":"x"}', headers);
    expect(objectWithoutError.body).toEqual({ message: 'x' });
  });

  it('maps statuses without a dedicated class to ApiError', () => {
    const error = createApiError('History API', 418, '', new Headers());
    expect(error.constructor).toBe(ApiError);
  });

  it('never throws while reading a broken header object', () => {
    const headers = {
      get: () => {
        throw new Error('broken');
      },
    };
    const error = createApiError('History API', 429, '', headers) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBeUndefined();
  });

  it('adds actionable hints', () => {
    expect(createApiError('History API', 401, '', new Headers()).message).toMatch(
      /Private API Key/,
    );
    expect(createApiError('Management API', 403, '', new Headers()).message).toMatch(
      /registered domain/,
    );
    expect(createApiError('Management API', 429, '', new Headers()).message).toMatch(/10 minutes/);
  });
});

describe('error classes', () => {
  it('form one hierarchy under ShieldLabsError', () => {
    const rateLimit = new RateLimitError('slow down', { status: 429, retryAfter: 2 });
    expect(rateLimit).toBeInstanceOf(ApiError);
    expect(rateLimit).toBeInstanceOf(ShieldLabsError);
    expect(rateLimit).toBeInstanceOf(Error);
    expect(rateLimit.retryAfter).toBe(2);
    expect(rateLimit.name).toBe('RateLimitError');
    expect(rateLimit.body).toBeNull();
    expect(rateLimit.headers.get('anything')).toBeNull();
    expect(String(rateLimit)).toBe('RateLimitError: slow down');
    expect(rateLimit.stack).toContain('RateLimitError: slow down');

    for (const ErrorClass of [ConnectionError, TimeoutError, ValidationError]) {
      const error = new ErrorClass('x', { cause: 'root' });
      expect(error).toBeInstanceOf(ShieldLabsError);
      expect(error).not.toBeInstanceOf(ApiError);
      expect(error.cause).toBe('root');
    }
    expect(new ShieldLabsError('x').cause).toBeUndefined();
  });
});

describe('Retry-After', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(' 1.5 ')).toBe(1.5);
    expect(parseRetryAfter('0')).toBe(0);
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(parseRetryAfter('Wed, 30 Sep 2026 12:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Wed, 30 Sep 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('-5')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it('is exposed on RateLimitError', async () => {
    const { client } = historyClient(
      [
        rawResponse('{"error":"too many requests"}\n', 429, 'application/json', {
          'Retry-After': '4',
        }),
      ],
      0,
    );
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect((error as RateLimitError).retryAfter).toBe(4);
  });
});

describe('retries', () => {
  function times(calls: { time: number }[]): number[] {
    return calls.map((call) => call.time - START);
  }

  it('retries connection errors with exponential backoff and jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { client, fake } = historyClient([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      historyPage([]),
    ]);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value).toEqual({ data: [], total: 0 });
    expect(times(fake.calls)).toEqual([0, 250, 750]);
  });

  it('uses the full nominal delay at the top of the jitter range', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const { client, fake } = historyClient([rawResponse('{"error":"internal error"}\n', 500)], 2);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).error).toBeInstanceOf(ServerError);
    const [first, second, third] = times(fake.calls);
    expect(first).toBe(0);
    expect(second).toBeGreaterThanOrEqual(499);
    expect(second).toBeLessThanOrEqual(500);
    expect((third ?? 0) - (second ?? 0)).toBeGreaterThanOrEqual(999);
    expect((third ?? 0) - (second ?? 0)).toBeLessThanOrEqual(1000);
  });

  it('caps the backoff at 8 seconds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const { client, fake } = historyClient([new TypeError('fetch failed')], 6);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).error).toBeInstanceOf(ConnectionError);
    const gaps = times(fake.calls)
      .slice(1)
      .map((t, i, all) => t - (i === 0 ? 0 : (all[i - 1] ?? 0)));
    expect(fake.calls).toHaveLength(7);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(8000);
    expect(gaps[5]).toBeGreaterThanOrEqual(7999);
  });

  it('honours Retry-After on a retryable response, capped at 10 seconds', async () => {
    const { client, fake } = historyClient([
      rawResponse('{"error":"server is busy"}', 503, 'application/json', { 'retry-after': '2' }),
      rawResponse('{"error":"too many requests"}\n', 429, 'application/json', {
        'retry-after': '60',
      }),
      historyPage([]),
    ]);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value).toEqual({ data: [], total: 0 });
    expect(times(fake.calls)).toEqual([0, 2000, 12_000]);
  });

  it('waits at least one second before retrying a History 429 without Retry-After', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { client, fake } = historyClient([
      rawResponse('{"error":"too many requests"}\n', 429),
      historyPage([]),
    ]);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    await result;
    expect(times(fake.calls)).toEqual([0, 1000]);
  });

  it('retries a History 429 after its Retry-After as sent, even when that is 0', async () => {
    // Only the wait of identifications.get raises the delay after a 429 to at least 1 s.
    const { client, fake } = historyClient([
      rawResponse('{"error":"too many requests"}\n', 429, 'application/json', {
        'retry-after': '0',
      }),
      rawResponse('{"error":"too many requests"}\n', 429, 'application/json', {
        'retry-after': '3',
      }),
      historyPage([]),
    ]);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value).toEqual({ data: [], total: 0 });
    expect(times(fake.calls)).toEqual([0, 0, 3000]);
  });

  it('does not retry with maxRetries 0', async () => {
    const { client, fake } = historyClient([new TypeError('fetch failed')], 0);
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).cause).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('fetch failed');
    expect(fake.calls).toHaveLength(1);
  });

  it('throws the last error after the retries are used up', async () => {
    const { client, fake } = historyClient([
      rawResponse('{"error":"a"}', 500),
      rawResponse('{"error":"b"}', 502),
      rawResponse('{"error":"c"}', 503),
    ]);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    const { error } = await result;
    expect((error as ServerError).status).toBe(503);
    expect(fake.calls).toHaveLength(3);
  });

  it.each([400, 401, 402, 403, 404])('never retries %s', async (status) => {
    const { client, fake } = historyClient([rawResponse('', status, null)], 5);
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).error).toBeInstanceOf(ApiError);
    expect(fake.calls).toHaveLength(1);
  });

  it('never retries a Management 429, even with Retry-After', async () => {
    const { client, fake } = managementClient(
      [
        rawResponse('{"error":"too many requests"}', 429, 'application/json; charset=utf-8', {
          'retry-after': '1',
        }),
      ],
      5,
    );
    const result = settle(client.getProfile());
    await vi.runAllTimersAsync();
    const { error } = await result;
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });

  it('retries Management server errors and connection failures', async () => {
    const { client, fake } = managementClient([
      rawResponse('{"error":"server is busy"}', 503, 'application/json; charset=utf-8'),
      new TypeError('socket hang up'),
      jsonResponse(loadJson('management-profile.json')),
    ]);
    const result = settle(client.getProfile());
    await vi.runAllTimersAsync();
    expect((await result).value?.domain).toBe('example.com');
    expect(fake.calls).toHaveLength(3);
  });

  it('times out an attempt and retries it', async () => {
    const hanging = hangingFetch();
    const client = new ShieldLabs({
      apiKey: TEST_API_KEY,
      fetch: hanging.fetch,
      timeout: 1500,
      maxRetries: 1,
    });
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    const { error } = await result;
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toContain('1500 ms');
    expect(hanging.calls).toHaveLength(2);
  });

  it('times out a response body that never finishes', async () => {
    const stalled = {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: () => new Promise<string>(() => undefined),
    };
    const client = new ShieldLabs({
      apiKey: TEST_API_KEY,
      fetch: () => Promise.resolve(stalled),
      timeout: 1000,
      maxRetries: 0,
    });
    const result = settle(client.history.search('request_id', REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).error).toBeInstanceOf(TimeoutError);
  });

  it('does not retry after the caller aborts', async () => {
    const hanging = hangingFetch();
    const controller = new AbortController();
    const client = new ShieldLabs({ apiKey: TEST_API_KEY, fetch: hanging.fetch, maxRetries: 3 });
    const result = settle(
      client.history.search('request_id', REQUEST_ID, { signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(5);
    controller.abort(new Error('caller gave up'));
    await vi.runAllTimersAsync();
    expect(((await result).error as Error).message).toBe('caller gave up');
    expect(hanging.calls).toHaveLength(1);
  });

  it('aborts while waiting between retries', async () => {
    const controller = new AbortController();
    const { client, fake } = historyClient([new TypeError('fetch failed')], 3);
    const result = settle(
      client.history.search('request_id', REQUEST_ID, { signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error('stop'));
    await vi.runAllTimersAsync();
    expect(((await result).error as Error).message).toBe('stop');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('connection errors', () => {
  function networkError(cause: { code?: string; message: string }): TypeError {
    return new TypeError('fetch failed', { cause: Object.assign(new Error(cause.message), cause) });
  }

  it.each([
    [
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 192.0.2.10:443' },
      'History API request failed: fetch failed (connect ECONNREFUSED 192.0.2.10:443)',
    ],
    [
      { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' },
      'History API request failed: fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error)',
    ],
    [{ code: 'ENOTFOUND', message: '' }, 'History API request failed: fetch failed (ENOTFOUND)'],
    [
      { message: 'unable to verify the first certificate' },
      'History API request failed: fetch failed (unable to verify the first certificate)',
    ],
  ])('name the network cause %j', async (cause, message) => {
    const { client } = historyClient([networkError(cause)], 0);
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toBe(message);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('withhold an underlying error that contains the Private API Key', async () => {
    const leaky = new TypeError(
      `Headers.append: "Bearer ${TEST_API_KEY}" is an invalid header value.`,
    );
    const { client } = historyClient([leaky], 0);
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toMatch(/withheld because it contained a credential/);
    expect((error as Error).cause).toBeUndefined();
    const { inspect } = await import('node:util');
    expect(inspect(error)).not.toContain(TEST_API_KEY);
  });

  it('withhold a nested cause or property that contains the Secret Key', async () => {
    const secret = '0123456789abcdef0123456789abcdef';
    const nested = new TypeError('fetch failed', {
      cause: new Error(`invalid header value "Bearer ${secret}"`),
    });
    const withProperty = Object.assign(new Error('request failed'), {
      config: { headers: { Authorization: `Bearer ${secret}` } },
    });
    for (const reply of [nested, withProperty]) {
      const { client } = managementClient([reply], 0);
      const { error } = await settle(client.getProfile());
      expect(error).toBeInstanceOf(ConnectionError);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it('check causes that are plain strings', async () => {
    const leaky = new TypeError('fetch failed', { cause: `Bearer ${TEST_API_KEY}` });
    const { client } = historyClient([leaky], 0);
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect((error as Error).message).not.toContain(TEST_API_KEY);
    expect((error as Error).cause).toBeUndefined();

    const harmless = new TypeError('fetch failed', { cause: 'socket closed' });
    const second = historyClient([harmless], 0);
    const result = await settle(second.client.history.search('request_id', REQUEST_ID));
    expect((result.error as Error).message).toBe('History API request failed: fetch failed');
    expect((result.error as Error).cause).toBe(harmless);
  });

  it('keep errors that only mention the domain', async () => {
    const { client } = managementClient([new TypeError('getaddrinfo ENOTFOUND example.com')], 0);
    const { error } = await settle(client.getProfile());
    expect((error as Error).message).toBe(
      'Management API request failed: getaddrinfo ENOTFOUND example.com',
    );
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('cope with a circular cause chain', async () => {
    const looping = new Error('socket hang up') as Error & { self?: unknown };
    looping.self = looping;
    const { client } = historyClient([looping], 0);
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect((error as Error).message).toBe('History API request failed: socket hang up');
  });
});

describe('fetch implementations', () => {
  it('wraps a fetch that throws synchronously in a ConnectionError', async () => {
    const client = new ShieldLabs({
      apiKey: TEST_API_KEY,
      maxRetries: 0,
      fetch: () => {
        throw new Error('bad init');
      },
    });
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(ConnectionError);
  });

  it('wraps a rejection that is not an Error', async () => {
    const client = new ShieldLabs({
      apiKey: TEST_API_KEY,
      maxRetries: 0,
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately not an Error
      fetch: () => Promise.reject('offline'),
    });
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toContain('offline');
  });

  it('uses the global fetch when none is given, looked up at request time', async () => {
    const client = new ShieldLabs({ apiKey: TEST_API_KEY, maxRetries: 0 });
    const fake = fakeFetch([historyPage([])]);
    vi.stubGlobal('fetch', fake.fetch);
    await expect(client.history.search('request_id', REQUEST_ID)).resolves.toEqual({
      data: [],
      total: 0,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('reports a missing global fetch as a ValidationError', async () => {
    vi.stubGlobal('fetch', undefined);
    const client = new ShieldLabs({ apiKey: TEST_API_KEY, maxRetries: 0 });
    await expect(client.history.search('request_id', REQUEST_ID)).rejects.toThrow(ValidationError);
  });

  it('passes an AuthenticationError from custom fetch responses through unchanged', async () => {
    const { client } = historyClient(
      [rawResponse('{"error":"invalid api key"}\n', 401, 'text/plain; charset=utf-8')],
      0,
    );
    const { error } = await settle(client.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
  });
});
