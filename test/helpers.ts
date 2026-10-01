import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import type { FetchLike, FetchRequestInit, Identification } from '../src/types.js';

export const TEST_API_KEY = 'sec_abcd1234-efgh5678-ijkl9012';
export const REQUEST_ID = 'a5b7c9d1-e3f5-4a7b-9c1d-3e5f7a9b1c3d';

export function dataPath(name: string): string {
  return fileURLToPath(new URL(`./data/${name}`, import.meta.url));
}

export function loadJson<T = any>(name: string): T {
  return JSON.parse(readFileSync(dataPath(name), 'utf8')) as T;
}

export function loadBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(dataPath(name)));
}

export function loadText(name: string): string {
  return readFileSync(dataPath(name), 'utf8');
}

export function withoutRaw(identification: Identification): Omit<Identification, 'raw'> {
  const { raw: _raw, ...rest } = identification;
  return rest;
}

const encoder = new TextEncoder();

/** Builds a fresh Response for every call, so one reply can answer many requests. */
export type ResponseFactory = () => Response;

/** A JSON response. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): ResponseFactory {
  const text = JSON.stringify(body);
  return () =>
    new Response(encoder.encode(text), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

/** A response with an exact body and content type (null means no Content-Type header). */
export function rawResponse(
  body: string,
  status: number,
  contentType: string | null = 'application/json',
  headers: Record<string, string> = {},
): ResponseFactory {
  return () => {
    const responseHeaders = new Headers(headers);
    if (contentType !== null) responseHeaders.set('content-type', contentType);
    return new Response(body === '' ? null : encoder.encode(body), {
      status,
      headers: responseHeaders,
    });
  };
}

export interface FakeCall {
  url: string;
  init: FetchRequestInit;
  time: number;
}

type Reply = Error | ResponseFactory;

/**
 * A fake fetch. `replies` is either a function computing the reply for each call, or a list of
 * replies used in order (the last one repeats).
 */
export function fakeFetch(replies: Reply[] | ((call: FakeCall, index: number) => Reply)) {
  const calls: FakeCall[] = [];
  const fetch = vi.fn((url: string, init: FetchRequestInit) => {
    const call: FakeCall = { url, init, time: Date.now() };
    calls.push(call);
    const index = calls.length - 1;
    const reply =
      typeof replies === 'function'
        ? replies(call, index)
        : (replies[Math.min(index, replies.length - 1)] as Reply);
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(reply());
  });
  return { fetch: fetch as unknown as FetchLike, calls, mock: fetch };
}

/** A fetch that never answers but rejects when its signal aborts. */
export function hangingFetch() {
  const calls: FakeCall[] = [];
  const fetch = vi.fn(
    (url: string, init: FetchRequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        calls.push({ url, init, time: Date.now() });
        init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
      }),
  );
  return { fetch: fetch as unknown as FetchLike, calls };
}

/** Settles a promise into a value or an error, so fake timers can run before assertions. */
export function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

/** One History page containing `rows`. */
export function historyPage(rows: unknown[], total = rows.length): ResponseFactory {
  return jsonResponse({ data: rows, total });
}

/** A History row copied from the fixture page, with a new request ID and optional changes. */
export function historyRow(
  requestId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const page = loadJson<{ data: Record<string, unknown>[] }>('history-page.json');
  return { ...(page.data[1] as Record<string, unknown>), request_id: requestId, ...overrides };
}

/** Formats a Date the way History rows carry created_at. */
export function historyTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}
