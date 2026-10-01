import {
  ApiError,
  AuthenticationError,
  BadRequestError,
  ConnectionError,
  NotFoundError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ShieldLabsError,
  TimeoutError,
  ValidationError,
  type ApiErrorOptions,
  type HeadersLike,
} from './errors.js';
import { isPlainObject } from './normalize.js';
import { abortReason, sleep, throwIfAborted, userAgent, warnOnce } from './runtime.js';
import type { FetchLike, FetchResponseLike } from './types.js';

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 8_000;
export const RETRY_AFTER_CAP_MS = 10_000;
/**
 * Shortest wait after a History 429 (the limit resets every second): after any 429 inside the wait
 * of `identifications.get`, and before retrying an ordinary request whose 429 had no Retry-After.
 * An ordinary request with Retry-After waits as long as it says, capped at RETRY_AFTER_CAP_MS.
 */
export const RATE_LIMIT_FLOOR_MS = 1_000;
const MAX_DETAIL_LENGTH = 200;

export type ApiName = 'History API' | 'Management API';

export interface TransportOptions {
  apiName: ApiName;
  /** Normalized base URL without a trailing slash. */
  baseUrl: string;
  /** Credential headers sent with every request. */
  headers: Record<string, string>;
  /** Credentials that must never appear in an error message or cause. */
  secrets: readonly string[];
  /** Per-attempt timeout in milliseconds. */
  timeout: number;
  maxRetries: number;
  /** False for the Management API: a 429 there starts a 10-minute block, so it is never retried. */
  retryRateLimited: boolean;
  fetch: FetchLike | undefined;
}

export interface RequestOptions {
  query?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  /** Overrides the transport's maxRetries for this call. */
  maxRetries?: number | undefined;
  /** Caps the attempt timeout of this call in milliseconds; the client timeout still applies. */
  timeout?: number | undefined;
}

export interface JsonResponse {
  body: unknown;
  status: number;
  headers: HeadersLike;
}

/** Loopback hosts, as the URL parser normalizes them. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/**
 * Normalizes a base URL: https origin plus an optional path prefix, no trailing slash. Plain http
 * is accepted for loopback hosts, and for other hosts only with `allowInsecureHttp`.
 * With `stripApiSuffix`, a trailing "/api" is removed so paths never become "/api/api/...".
 */
export function normalizeBaseUrl(
  input: unknown,
  name: string,
  stripApiSuffix: boolean,
  allowInsecureHttp = false,
): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ValidationError(`${name} must be a non-empty URL.`);
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ValidationError(`${name} is not a valid URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError(`${name} must be an https URL.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new ValidationError(`${name} must not contain credentials.`);
  }
  if (url.search !== '' || url.hash !== '') {
    throw new ValidationError(`${name} must not contain a query string or a fragment.`);
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    if (!allowInsecureHttp) {
      throw new ValidationError(
        `${name} must be an https URL: with plain http the key would travel unencrypted. Plain http is accepted for localhost, 127.0.0.1 and [::1]; for a test server on another host, pass allowInsecureHttp: true.`,
      );
    }
    warnOnce(
      `insecure-base-url:${url.origin}`,
      `${name} uses plain http, so credentials travel unencrypted. Use https outside local testing.`,
    );
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (stripApiSuffix && /\/api$/i.test(path)) path = path.slice(0, -4).replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Parses a Retry-After header (delta seconds or an HTTP date) into seconds. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  // HTTP dates always name the weekday and month ("Wed, 30 Sep 2026 12:00:30 GMT").
  if (!/[a-z]{3}/i.test(text)) return undefined;
  const date = Date.parse(text);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 3)}...` : text;
}

function errorDetail(body: unknown, parsedJson: boolean, text: string): string | undefined {
  if (parsedJson) {
    if (isPlainObject(body) && typeof body.error === 'string' && body.error !== '') {
      return truncate(body.error);
    }
    if (typeof body === 'string' && body !== '') return truncate(body);
    return undefined;
  }
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('<')) return undefined;
  return truncate(trimmed);
}

function hintFor(apiName: ApiName, status: number): string {
  if (status === 401 || status === 403) {
    return apiName === 'History API'
      ? ' Check that apiKey is the Private API Key (sec_...) of this domain.'
      : ' Check the Secret Key and that domain matches the registered domain exactly.';
  }
  if (status === 404) return ' Check the base URL.';
  if (status === 429 && apiName === 'Management API') {
    return ' The Management API allows about 15 requests per minute per IP, then blocks the IP for 10 minutes.';
  }
  return '';
}

/** Maps an error response to the matching error class. Never throws. */
export function createApiError(
  apiName: ApiName,
  status: number,
  text: string,
  headers: HeadersLike,
): ApiError {
  let body: unknown = null;
  let parsedJson = false;
  if (text !== '') {
    try {
      body = JSON.parse(text);
      parsedJson = true;
    } catch {
      body = text;
    }
  }
  const detail = errorDetail(body, parsedJson, text);
  const message = `${apiName} request failed with HTTP ${status}${detail ? ` (${detail})` : ''}.${hintFor(apiName, status)}`;
  const options: ApiErrorOptions = { status, body, headers };
  if (status === 400) return new BadRequestError(message, options);
  if (status === 401 || status === 403) return new AuthenticationError(message, options);
  if (status === 402) return new QuotaExceededError(message, options);
  if (status === 404) return new NotFoundError(message, options);
  if (status === 429) {
    let retryAfter: number | undefined;
    try {
      retryAfter = parseRetryAfter(headers.get('retry-after'));
    } catch {
      retryAfter = undefined;
    }
    return new RateLimitError(message, { ...options, retryAfter });
  }
  if (status >= 500 && status <= 599) return new ServerError(message, options);
  return new ApiError(message, options);
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * The network cause behind a failed fetch, for example " (connect ECONNREFUSED 192.0.2.1:443)":
 * runtimes wrap it in a generic "fetch failed" error.
 */
function causeDetail(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (typeof cause !== 'object' || cause === null) return '';
  const { code, message } = cause as { code?: unknown; message?: unknown };
  const codeText = typeof code === 'string' ? code : '';
  const text = typeof message === 'string' ? message.trim() : '';
  if (text !== '' && codeText !== '' && !text.includes(codeText)) {
    return ` (${codeText}: ${truncate(text)})`;
  }
  if (text !== '') return ` (${truncate(text)})`;
  return codeText === '' ? '' : ` (${codeText})`;
}

/** Text an error and its causes can print: messages, stacks and their own string properties. */
function printableTexts(error: unknown): string[] {
  const texts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (typeof current !== 'object') {
      if (typeof current === 'string') texts.push(current);
      break;
    }
    const { message, stack } = current as { message?: unknown; stack?: unknown };
    if (typeof message === 'string') texts.push(message);
    if (typeof stack === 'string') texts.push(stack);
    try {
      texts.push(JSON.stringify(current) ?? '');
    } catch {
      // Circular or otherwise unserializable: the message and stack above still count.
    }
    current = (current as { cause?: unknown }).cause;
  }
  return texts;
}

function mentionsSecret(texts: readonly string[], secrets: readonly string[]): boolean {
  return secrets.some((secret) => secret !== '' && texts.some((text) => text.includes(secret)));
}

/** Resolves when `promise` settles, or rejects as soon as `signal` aborts (even if `promise` never settles). */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function globalFetch(): FetchLike {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== 'function') {
    throw new ValidationError(
      'No fetch implementation is available. Use Node.js 18 or later, or pass the fetch option.',
    );
  }
  const fetchFn = candidate as FetchLike;
  return (url, init) => fetchFn.call(globalThis, url, init);
}

/** Sends GET requests with timeouts, retries and error mapping. Safe for concurrent use. */
export class Transport {
  readonly #options: TransportOptions;

  constructor(options: TransportOptions) {
    this.#options = options;
  }

  /** The client's per-attempt timeout in milliseconds. */
  get timeout(): number {
    return this.#options.timeout;
  }

  async getJson(path: string, options: RequestOptions = {}): Promise<JsonResponse> {
    const maxRetries = options.maxRetries ?? this.#options.maxRetries;
    let url = `${this.#options.baseUrl}${path}`;
    if (options.query) url += `?${new URLSearchParams(options.query).toString()}`;
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(options.signal);
      try {
        return await this.#attempt(url, options.signal, options.timeout);
      } catch (error) {
        if (attempt >= maxRetries || !this.#isRetryable(error)) throw error;
        await sleep(this.#retryDelay(error, attempt), options.signal);
      }
    }
  }

  #isRetryable(error: unknown): boolean {
    if (error instanceof ConnectionError || error instanceof TimeoutError) return true;
    if (error instanceof RateLimitError) return this.#options.retryRateLimited;
    return error instanceof ServerError;
  }

  #retryDelay(error: unknown, attempt: number): number {
    if (error instanceof ApiError) {
      const retryAfter =
        error instanceof RateLimitError
          ? error.retryAfter
          : parseRetryAfter(error.headers.get('retry-after'));
      if (retryAfter !== undefined) return Math.min(retryAfter * 1000, RETRY_AFTER_CAP_MS);
    }
    const nominal = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
    const delay = nominal / 2 + Math.random() * (nominal / 2);
    return error instanceof RateLimitError ? Math.max(delay, RATE_LIMIT_FLOOR_MS) : delay;
  }

  #connectionError(error: unknown): ConnectionError {
    const { apiName, secrets } = this.#options;
    const message = `${apiName} request failed: ${messageOf(error)}${causeDetail(error)}`;
    if (mentionsSecret([message, ...printableTexts(error)], secrets)) {
      // For example a runtime error that echoes a header value: keep it out of logs entirely.
      return new ConnectionError(
        `${apiName} request failed before a response was received. The underlying error was withheld because it contained a credential.`,
      );
    }
    return new ConnectionError(message, { cause: error });
  }

  async #attempt(
    url: string,
    signal: AbortSignal | undefined,
    timeoutCap: number | undefined,
  ): Promise<JsonResponse> {
    const { apiName } = this.#options;
    const timeout = Math.min(this.#options.timeout, timeoutCap ?? Number.POSITIVE_INFINITY);
    const fetchImpl = this.#options.fetch ?? globalFetch();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let response: FetchResponseLike;
    let text: string;
    try {
      const init = {
        method: 'GET' as const,
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent(),
          ...this.#options.headers,
        },
        signal: controller.signal,
      };
      response = await raceWithAbort(
        Promise.resolve().then(() => fetchImpl(url, init)),
        controller.signal,
      );
      text = await raceWithAbort(
        Promise.resolve().then(() => response.text()),
        controller.signal,
      );
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (timedOut) {
        throw new TimeoutError(`${apiName} request timed out after ${timeout} ms.`, {
          cause: error,
        });
      }
      if (error instanceof ShieldLabsError) throw error;
      throw this.#connectionError(error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    const { status, headers } = response;
    if (status >= 200 && status < 300) {
      try {
        return { body: JSON.parse(text) as unknown, status, headers };
      } catch (error) {
        throw new ApiError(
          `${apiName} returned a response that is not valid JSON (HTTP ${status}).`,
          {
            status,
            body: text,
            headers,
            cause: error,
          },
        );
      }
    }
    throw createApiError(apiName, status, text, headers);
  }
}
