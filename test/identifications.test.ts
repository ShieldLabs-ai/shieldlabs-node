import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  AuthenticationError,
  BadRequestError,
  ConnectionError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ShieldLabs,
  TimeoutError,
} from '../src/index.js';
import { pollWait } from '../src/history.js';
import type { FetchLike, FetchRequestInit } from '../src/types.js';
import {
  REQUEST_ID,
  TEST_API_KEY,
  fakeFetch,
  hangingFetch,
  historyPage,
  historyRow,
  jsonResponse,
  rawResponse,
  settle,
  type ResponseFactory,
} from './helpers.js';

const START = Date.parse('2026-09-30T12:00:00.000Z');
const empty = () => historyPage([]);
const found = () => historyPage([historyRow(REQUEST_ID)]);
const tooMany = (headers: Record<string, string> = {}) =>
  rawResponse('{"error":"too many requests"}\n', 429, 'application/json', headers);
const serverError = (status = 500) => rawResponse(`{"error":"status ${status}"}\n`, status);

function client(
  replies: Parameters<typeof fakeFetch>[0],
  options: { timeout?: number; maxRetries?: number } = {},
) {
  const fake = fakeFetch(replies);
  const shieldlabs = new ShieldLabs({ apiKey: TEST_API_KEY, fetch: fake.fetch, ...options });
  return { shieldlabs, fake };
}

function offsets(calls: { time: number }[]): number[] {
  return calls.map((call) => call.time - START);
}

interface Outcome<T> {
  value?: T;
  error?: unknown;
  /** Milliseconds after START at which the promise settled. */
  at: number;
}

/** Settles a promise into its value or error and the fake-clock time at which it settled. */
function outcome<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    (value) => ({ value, at: Date.now() - START }),
    (error: unknown) => ({ error, at: Date.now() - START }),
  );
}

interface Attempt {
  start: number;
  end?: number;
}

/**
 * A fetch that records when each attempt starts and ends. `reply` answers an attempt with a
 * response, rejects it with an error, or leaves it open ('hang') until its signal aborts.
 */
function recordingFetch(reply: (index: number) => ResponseFactory | Error | 'hang') {
  const attempts: Attempt[] = [];
  const fetch = (_url: string, init: FetchRequestInit) => {
    const attempt: Attempt = { start: Date.now() - START };
    attempts.push(attempt);
    const answer = reply(attempts.length - 1);
    if (answer === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          attempt.end = Date.now() - START;
          reject(init.signal.reason as Error);
        });
      });
    }
    attempt.end = attempt.start;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer());
  };
  const starts = () => attempts.map((attempt) => attempt.start);
  const durations = () => attempts.map((attempt) => (attempt.end ?? Number.NaN) - attempt.start);
  return { fetch: fetch as unknown as FetchLike, starts, durations };
}

/** A fetch whose every answer takes `latency` milliseconds. */
function slowFetch(latency: number, reply: ResponseFactory) {
  const calls: number[] = [];
  const fetch = (_url: string, init: FetchRequestInit) =>
    new Promise<Response>((resolve, reject) => {
      calls.push(Date.now() - START);
      const timer = setTimeout(() => resolve(reply()), latency);
      init.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal.reason as Error);
      });
    });
  return { fetch: fetch as unknown as FetchLike, calls };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('identifications.get without waiting', () => {
  it('reads once with limit 1 and returns the identification', async () => {
    const { shieldlabs, fake } = client([found()]);
    const identification = await shieldlabs.identifications.get(REQUEST_ID, { wait: false });
    expect(identification?.request_id).toBe(REQUEST_ID);
    expect(fake.calls).toHaveLength(1);
    const url = new URL(fake.calls[0]?.url ?? '');
    expect(url.pathname).toBe(`/api/v1/history/request_id/${REQUEST_ID}`);
    expect(url.search).toBe('?limit=1&offset=0');
  });

  it('returns null when there is no row yet', async () => {
    const { shieldlabs, fake } = client([empty()]);
    await expect(shieldlabs.identifications.get(REQUEST_ID, { wait: false })).resolves.toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  it('uses the normal retry policy for a single read', async () => {
    const { shieldlabs, fake } = client([serverError(), found()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID, { wait: false }));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    expect(fake.calls).toHaveLength(2);
  });

  it('sends the request ID in lowercase', async () => {
    const { shieldlabs, fake } = client([found()]);
    await shieldlabs.identifications.get(REQUEST_ID.toUpperCase(), { wait: false });
    expect(fake.calls[0]?.url).toContain(REQUEST_ID);
  });
});

describe('identifications.get: timeout is the total budget', () => {
  it('returns at once when the first poll finds the row', async () => {
    const { shieldlabs, fake } = client([found()]);
    await expect(shieldlabs.identifications.get(REQUEST_ID)).resolves.toMatchObject({
      request_id: REQUEST_ID,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('stops polling as soon as the row appears', async () => {
    const { shieldlabs, fake } = client([empty(), empty(), found()]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    const { value, at } = await result;
    expect(value?.request_id).toBe(REQUEST_ID);
    expect(at).toBe(750);
    expect(offsets(fake.calls)).toEqual([0, 250, 750]);
  });

  it('resolves null at the default deadline of 10 seconds', async () => {
    const { shieldlabs } = client([empty()]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: null, at: 10_000 });
  });

  it('counts the time spent in requests against the budget', async () => {
    const slow = slowFetch(600, empty());
    const shieldlabs = new ShieldLabs({ apiKey: TEST_API_KEY, fetch: slow.fetch });
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 2000 }));
    await vi.runAllTimersAsync();
    // Polls answer after 600 ms: 0-600, then 850-1450, then 1950-2550, which ends after the
    // deadline and so is the last poll.
    expect(slow.calls).toEqual([0, 850, 1950]);
    expect(await result).toEqual({ value: null, at: 2550 });
  });

  it('polls once for timeout 0', async () => {
    const { shieldlabs, fake } = client([empty()]);
    await expect(shieldlabs.identifications.get(REQUEST_ID, { timeout: 0 })).resolves.toBeNull();
    expect(fake.calls).toHaveLength(1);
  });
});

describe('identifications.get: poll schedule', () => {
  it('polls immediately, then after 250 ms, 500 ms, 1 s, 1.5 s and every 2 s until the timeout', async () => {
    const { shieldlabs, fake } = client([empty()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: null });
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1750, 3250, 5250, 7250, 9250, 10000]);
  });

  it('waits pollInterval times 1, 2, 4 and 6, then 8 times it for every later wait', async () => {
    const { shieldlabs, fake } = client([empty()]);
    const result = outcome(
      shieldlabs.identifications.get(REQUEST_ID, { pollInterval: 100, timeout: 3000 }),
    );
    await vi.runAllTimersAsync();
    // Waits of 100, 200, 400, 600 and then 800 ms; the wait after the poll at 2900 is cut to the
    // 100 ms left.
    expect(await result).toEqual({ value: null, at: 3000 });
    expect(offsets(fake.calls)).toEqual([0, 100, 300, 700, 1300, 2100, 2900, 3000]);
  });

  it('caps each wait of a custom pollInterval at 2 s', async () => {
    const { shieldlabs, fake } = client([empty()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID, { pollInterval: 300 }));
    await vi.runAllTimersAsync();
    await result;
    // Waits of 300, 600, 1200 and 1800 ms, then 2 s instead of 2.4 s.
    expect(offsets(fake.calls)).toEqual([0, 300, 900, 2100, 3900, 5900, 7900, 9900, 10000]);
  });

  it.each([
    // [pollInterval, scheduled waits, poll times of the default 10 s wait]
    [250, [250, 500, 1000, 1500, 2000, 2000], [0, 250, 750, 1750, 3250, 5250, 7250, 9250, 10000]],
    [1000, [1000, 2000, 2000, 2000], [0, 1000, 3000, 5000, 7000, 9000, 10000]],
    [3000, [3000, 3000, 3000, 3000], [0, 3000, 6000, 9000, 10000]],
  ])(
    'waits p, 2p, 4p, 6p and 8p, each at most max(2 s, p), for pollInterval %i',
    async (pollInterval, waits, polls) => {
      const { shieldlabs, fake } = client([empty()]);
      const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { pollInterval }));
      await vi.runAllTimersAsync();
      expect(await result).toEqual({ value: null, at: 10_000 });
      expect(offsets(fake.calls)).toEqual(polls);
      expect(waits.map((_wait, index) => pollWait(index, pollInterval))).toEqual(waits);
    },
  );

  it('waits the whole pollInterval when it is longer than one timer allows', async () => {
    const { shieldlabs, fake } = client([empty()]);
    const result = outcome(
      shieldlabs.identifications.get(REQUEST_ID, {
        pollInterval: 3_000_000_000,
        timeout: 7_000_000_000,
      }),
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: null, at: 7_000_000_000 });
    expect(offsets(fake.calls)).toEqual([0, 3_000_000_000, 6_000_000_000, 7_000_000_000]);
  });

  it.each([
    [250, [250, 500, 1000, 1500, 2000, 2000, 2000]],
    [100, [100, 200, 400, 600, 800, 800, 800]],
    [10, [10, 20, 40, 60, 80, 80, 80]], // no lower limit
    [300, [300, 600, 1200, 1800, 2000, 2000, 2000]],
    [1000, [1000, 2000, 2000, 2000, 2000, 2000, 2000]],
    [2000, [2000, 2000, 2000, 2000, 2000, 2000, 2000]],
    [3000, [3000, 3000, 3000, 3000, 3000, 3000, 3000]],
    [60_000, [60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000]],
  ])('computes the scheduled waits for pollInterval %i', (pollInterval, expected) => {
    expect(expected.map((_wait, index) => pollWait(index, pollInterval))).toEqual(expected);
  });
});

describe('identifications.get: the last poll runs at the deadline', () => {
  it.each([
    [0, [0]],
    [100, [0, 100]],
    [1000, [0, 250, 750, 1000]],
    [3250, [0, 250, 750, 1750, 3250]],
    [4000, [0, 250, 750, 1750, 3250, 4000]],
  ])('with timeout %i', async (timeout, expected) => {
    const { shieldlabs, fake } = client([empty()]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout }));
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: null, at: timeout });
    expect(offsets(fake.calls)).toEqual(expected);
  });

  it('makes exactly one poll at the deadline, even when the clock then reads a little early', async () => {
    const deadline = START + 1000;
    const { shieldlabs, fake } = client((call) => {
      // A timer that fires a few milliseconds early leaves the clock just before the deadline.
      if (call.time >= deadline) vi.setSystemTime(deadline - 5);
      return empty();
    });
    const result = settle(shieldlabs.identifications.get(REQUEST_ID, { timeout: 1000 }));
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: null });
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1000]);
  });

  it('shortens a wait stretched by a 429 so that the last poll still runs at the deadline', async () => {
    const { shieldlabs, fake } = client([tooMany()]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 2500 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(at).toBe(2500);
    expect(offsets(fake.calls)).toEqual([0, 1000, 2000, 2500]);
  });

  it('polls at the deadline when Retry-After fits in the time left but the next step does not', async () => {
    const { shieldlabs, fake } = client([
      empty(),
      empty(),
      empty(),
      tooMany({ 'retry-after': '1' }),
      found(),
    ]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 3000 }));
    await vi.runAllTimersAsync();
    const { value, at } = await result;
    // The 429 at 1750 asks for 1 s and 1.25 s are left: the 1.5 s step is cut to the deadline.
    expect(value?.request_id).toBe(REQUEST_ID);
    expect(at).toBe(3000);
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1750, 3000]);
  });
});

describe('identifications.get: one HTTP attempt per poll', () => {
  it.each([
    ['a 5xx', serverError(503), ServerError, 1000, [0, 250, 750, 1000]],
    [
      'a connection failure',
      new TypeError('fetch failed'),
      ConnectionError,
      1000,
      [0, 250, 750, 1000],
    ],
    ['a 429', tooMany(), RateLimitError, 2000, [0, 1000, 2000]],
  ])(
    'never retries %s inside a poll, whatever maxRetries is',
    async (_label, reply, ErrorClass, timeout, expected) => {
      const { shieldlabs, fake } = client([reply], { maxRetries: 5 });
      const result = settle(shieldlabs.identifications.get(REQUEST_ID, { timeout }));
      await vi.runAllTimersAsync();
      expect((await result).error).toBeInstanceOf(ErrorClass);
      expect(offsets(fake.calls)).toEqual(expected);
    },
  );

  it.each([
    // [client timeout, get timeout, attempt timeout of the first poll]
    [10_000, 3_000, 3_000], // the time left
    [500, 3_000, 500], // the client timeout
    [10_000, 400, 1_000], // at least 1 s
    [10_000, 0, 1_000], // at least 1 s, also for the only poll
    [800, 400, 800], // the client timeout, even below 1 s
  ])(
    'limits the first attempt to min(client timeout %i, max(time left of %i, 1 s))',
    async (clientTimeout, timeout, expected) => {
      const recorder = recordingFetch(() => 'hang');
      const shieldlabs = new ShieldLabs({
        apiKey: TEST_API_KEY,
        fetch: recorder.fetch,
        timeout: clientTimeout,
      });
      const result = settle(shieldlabs.identifications.get(REQUEST_ID, { timeout }));
      await vi.runAllTimersAsync();
      expect((await result).error).toBeInstanceOf(TimeoutError);
      expect(recorder.durations()[0]).toBe(expected);
    },
  );

  it('computes the attempt timeout again for every poll', async () => {
    const recorder = recordingFetch(() => 'hang');
    const shieldlabs = new ShieldLabs({
      apiKey: TEST_API_KEY,
      fetch: recorder.fetch,
      timeout: 2000,
    });
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 4000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    // First poll: the 2 s client timeout. Second poll at 2250: the 1.75 s left.
    expect(recorder.starts()).toEqual([0, 2250]);
    expect(recorder.durations()).toEqual([2000, 1750]);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toContain('1750 ms');
    expect(at).toBe(4000);
  });

  it('gives a poll near the deadline at least one second', async () => {
    const recorder = recordingFetch((index) => (index < 2 ? empty() : 'hang'));
    const shieldlabs = new ShieldLabs({ apiKey: TEST_API_KEY, fetch: recorder.fetch });
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 1000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    // The third poll starts at 750 with 250 ms left and still gets 1 s.
    expect(recorder.starts()).toEqual([0, 250, 750]);
    expect(recorder.durations()[2]).toBe(1000);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toContain('1000 ms');
    expect(at).toBe(1750);
  });

  it('limits a hanging poll to the time left before the deadline', async () => {
    const hanging = hangingFetch();
    const shieldlabs = new ShieldLabs({ apiKey: TEST_API_KEY, fetch: hanging.fetch });
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 3000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toContain('3000 ms');
    expect(at).toBe(3000);
    expect(hanging.calls).toHaveLength(1);
  });
});

describe('identifications.get: transient errors keep polling', () => {
  it('keeps polling through 5xx, connection errors, 429 and attempt timeouts', async () => {
    const replies = [
      serverError(500),
      new TypeError('fetch failed'),
      tooMany(),
      serverError(502),
      'hang' as const,
    ];
    const recorder = recordingFetch((index) => replies[index] ?? found());
    const shieldlabs = new ShieldLabs({
      apiKey: TEST_API_KEY,
      fetch: recorder.fetch,
      timeout: 1000,
    });
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    const { value, at } = await result;
    // Waits of 250 ms, 500 ms, 1 s (also the minimum after a 429) and 1.5 s; the poll at 3250
    // times out after its 1 s attempt and the next one follows the 2 s step.
    expect(value?.request_id).toBe(REQUEST_ID);
    expect(recorder.starts()).toEqual([0, 250, 750, 1750, 3250, 6250]);
    expect(at).toBe(6250);
  });

  it.each([
    ['a 5xx', serverError(504), ServerError],
    ['a connection failure', new TypeError('getaddrinfo ENOTFOUND'), ConnectionError],
    ['a 429', tooMany(), RateLimitError],
  ])(
    'throws the error of the last poll at the deadline when it was %s',
    async (_label, last, ErrorClass) => {
      const { shieldlabs, fake } = client([
        serverError(500),
        new TypeError('fetch failed'),
        empty(),
        last,
      ]);
      const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 2000 }));
      await vi.runAllTimersAsync();
      const { error, at } = await result;
      expect(error).toBeInstanceOf(ErrorClass);
      expect(at).toBe(2000);
      expect(offsets(fake.calls)).toEqual([0, 250, 750, 1750, 2000]);
    },
  );

  it('throws the error of the last poll, not an earlier one', async () => {
    const { shieldlabs, fake } = client([
      serverError(500),
      serverError(503),
      serverError(502),
      serverError(504),
    ]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 1000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).status).toBe(504);
    expect(at).toBe(1000);
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1000]);
  });

  it('throws a TimeoutError when the last poll timed out', async () => {
    const hanging = hangingFetch();
    const shieldlabs = new ShieldLabs({
      apiKey: TEST_API_KEY,
      fetch: hanging.fetch,
      timeout: 1000,
    });
    const result = settle(shieldlabs.identifications.get(REQUEST_ID, { timeout: 0 }));
    await vi.runAllTimersAsync();
    expect((await result).error).toBeInstanceOf(TimeoutError);
  });

  it('resolves null when the last poll found nothing, even after failed polls', async () => {
    const { shieldlabs, fake } = client([
      serverError(500),
      new TypeError('fetch failed'),
      tooMany(),
      empty(),
    ]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 3000 }));
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: null, at: 3000 });
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1750, 3000]);
  });
});

describe('identifications.get: 429 while waiting', () => {
  it('waits at least 1 s after a 429 without Retry-After, then keeps polling', async () => {
    const { shieldlabs, fake } = client([tooMany(), found()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    expect(offsets(fake.calls)).toEqual([0, 1000]);
  });

  it('keeps a scheduled wait longer than 1 s after a 429 without Retry-After', async () => {
    const { shieldlabs, fake } = client([empty(), empty(), empty(), tooMany(), found()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1750, 3250]);
  });

  it('throws the RateLimitError at the deadline when every poll was rate limited', async () => {
    const { shieldlabs, fake } = client([tooMany()]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 3000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(at).toBe(3000);
    expect(offsets(fake.calls)).toEqual([0, 1000, 2000, 3000]);
  });

  it('waits for Retry-After', async () => {
    const { shieldlabs, fake } = client([empty(), tooMany({ 'retry-after': '3' }), found()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    expect(offsets(fake.calls)).toEqual([0, 250, 3250]);
  });

  it.each([
    ['Retry-After: 0', '0'],
    ['a Retry-After date in the past', 'Wed, 30 Sep 2026 11:59:30 GMT'],
  ])('counts %s as 0 and still waits at least 1 s', async (_label, retryAfter) => {
    const { shieldlabs, fake } = client([empty(), tooMany({ 'retry-after': retryAfter }), found()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    // The 429 at 250 would be followed by the 500 ms step: the 1 s floor wins.
    expect(offsets(fake.calls)).toEqual([0, 250, 1250]);
  });

  it('keeps a scheduled wait longer than Retry-After', async () => {
    const replies = [empty(), empty(), empty(), empty(), tooMany({ 'retry-after': '1' }), found()];
    const { shieldlabs, fake } = client(replies);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    // The 429 at 3250 asks for 1 s; the scheduled 2 s step is longer and applies.
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1750, 3250, 5250]);
  });

  it('waits at least 1 s after a 429 with a short pollInterval, then resumes the schedule', async () => {
    const { shieldlabs, fake } = client([
      empty(),
      tooMany({ 'retry-after': '0' }),
      empty(),
      found(),
    ]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID, { pollInterval: 100 }));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    // Waits of 100 ms, 1 s instead of 200 ms after the 429, then the 400 ms step.
    expect(offsets(fake.calls)).toEqual([0, 100, 1100, 1500]);
  });

  it.each([
    // [label, Retry-After header, poll times]: the 3 s step is longer than 1 s and Retry-After 2.
    ['without Retry-After', {}, [0, 3000, 6000]],
    ['with a shorter Retry-After', { 'retry-after': '2' }, [0, 3000, 6000]],
    ['with a longer Retry-After', { 'retry-after': '5' }, [0, 5000, 8000]],
  ])('keeps the ladder of a 3 s pollInterval after a 429 %s', async (_label, headers, expected) => {
    const { shieldlabs, fake } = client([tooMany(headers), empty(), found()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID, { pollInterval: 3000 }));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    expect(offsets(fake.calls)).toEqual(expected);
  });

  it.each([
    ['without Retry-After', {}],
    ['with Retry-After: 0', { 'retry-after': '0' }],
    ['with a Retry-After date in the past', { 'retry-after': 'Wed, 30 Sep 2026 11:59:30 GMT' }],
  ])('polls at the deadline after a 429 %s when less than 1 s is left', async (_label, headers) => {
    const { shieldlabs, fake } = client([empty(), empty(), tooMany(headers), found()]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 1000 }));
    await vi.runAllTimersAsync();
    const { value, at } = await result;
    // The 429 at 750 leaves 250 ms: the 1 s wait is cut to the deadline instead of throwing.
    expect(value?.request_id).toBe(REQUEST_ID);
    expect(at).toBe(1000);
    expect(offsets(fake.calls)).toEqual([0, 250, 750, 1000]);
  });

  it('throws at once when a short Retry-After is still longer than the time left', async () => {
    const { shieldlabs, fake } = client([empty(), empty(), tooMany({ 'retry-after': '1' })]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 1000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    // The 429 at 750 asks for 1 s and only 250 ms are left.
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(1);
    expect(at).toBe(750);
    expect(offsets(fake.calls)).toEqual([0, 250, 750]);
  });

  it('caps Retry-After at 10 seconds', async () => {
    const { shieldlabs, fake } = client([tooMany({ 'retry-after': '120' }), found()]);
    const result = settle(shieldlabs.identifications.get(REQUEST_ID, { timeout: 30_000 }));
    await vi.runAllTimersAsync();
    expect((await result).value?.request_id).toBe(REQUEST_ID);
    expect(offsets(fake.calls)).toEqual([0, 10_000]);
  });

  it('throws the RateLimitError at once when Retry-After is longer than the time left', async () => {
    const { shieldlabs, fake } = client([empty(), tooMany({ 'retry-after': '5' })]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 3000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(5);
    expect(at).toBe(250);
    expect(fake.calls).toHaveLength(2);
  });

  it('compares the capped Retry-After with the time left', async () => {
    const { shieldlabs, fake } = client([tooMany({ 'retry-after': '120' })]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 9_000 }));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(at).toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  it('keeps polling when Retry-After equals the time left', async () => {
    const { shieldlabs, fake } = client([tooMany({ 'retry-after': '2' }), found()]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID, { timeout: 2000 }));
    await vi.runAllTimersAsync();
    const { value, at } = await result;
    expect(value?.request_id).toBe(REQUEST_ID);
    expect(at).toBe(2000);
    expect(offsets(fake.calls)).toEqual([0, 2000]);
  });
});

describe('identifications.get: errors another poll cannot fix', () => {
  it.each([
    [400, BadRequestError, 'null', 'application/json'],
    [401, AuthenticationError, '{"error":"invalid api key"}\n', 'text/plain; charset=utf-8'],
    [403, AuthenticationError, '', null],
    [404, NotFoundError, '404 page not found', 'text/plain; charset=utf-8'],
  ])('stops at once on %s', async (status, ErrorClass, body, contentType) => {
    const { shieldlabs, fake } = client([empty(), rawResponse(body, status, contentType)]);
    const result = outcome(shieldlabs.identifications.get(REQUEST_ID));
    await vi.runAllTimersAsync();
    const { error, at } = await result;
    expect(error).toBeInstanceOf(ErrorClass);
    expect((error as ApiError).status).toBe(status);
    expect(at).toBe(250);
    expect(fake.calls).toHaveLength(2);
  });

  it('stops at once on a response body it cannot use', async () => {
    const { shieldlabs, fake } = client([jsonResponse({ unexpected: true })]);
    const { error } = await settle(shieldlabs.identifications.get(REQUEST_ID));
    expect(error).toBeInstanceOf(ApiError);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('identifications.get cancellation', () => {
  it('rejects with the abort reason while waiting and stops polling', async () => {
    const controller = new AbortController();
    const { shieldlabs, fake } = client([empty()]);
    const result = settle(
      shieldlabs.identifications.get(REQUEST_ID, { signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(300);
    controller.abort(new Error('request cancelled'));
    await vi.runAllTimersAsync();
    expect(((await result).error as Error).message).toBe('request cancelled');
    expect(fake.calls).toHaveLength(2);
  });

  it('rejects at once for an aborted signal', async () => {
    const { shieldlabs, fake } = client([found()]);
    const controller = new AbortController();
    controller.abort();
    const { error } = await settle(
      shieldlabs.identifications.get(REQUEST_ID, { signal: controller.signal }),
    );
    expect((error as Error).name).toBe('AbortError');
    expect(fake.calls).toHaveLength(0);
  });

  it('aborts an in-flight request', async () => {
    const hanging = hangingFetch();
    const controller = new AbortController();
    const shieldlabs = new ShieldLabs({ apiKey: TEST_API_KEY, fetch: hanging.fetch });
    const result = settle(
      shieldlabs.identifications.get(REQUEST_ID, { signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error('client went away'));
    expect(((await result).error as Error).message).toBe('client went away');
    expect(hanging.calls).toHaveLength(1);
  });

  it('rejects with the abort reason when the signal aborts while a poll fails', async () => {
    const controller = new AbortController();
    const { shieldlabs, fake } = client(() => {
      controller.abort(new Error('caller gave up'));
      return serverError(503);
    });
    const { error } = await settle(
      shieldlabs.identifications.get(REQUEST_ID, { signal: controller.signal }),
    );
    expect((error as Error).message).toBe('caller gave up');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('identifications.get returns normalized data', () => {
  it('returns the first row as an Identification', async () => {
    const { shieldlabs } = client([
      jsonResponse({ data: [historyRow(REQUEST_ID, { score: 85 })], total: 1 }),
    ]);
    const identification = await shieldlabs.identifications.get(REQUEST_ID);
    expect(identification?.risk_score).toBe(85);
    expect(identification?.source).toBe('history');
  });
});
