/**
 * Error hierarchy of the SDK.
 *
 * ShieldLabsError
 *   ApiError (the server answered with an error status or an unusable body)
 *     BadRequestError (400), AuthenticationError (401, 403), QuotaExceededError (402),
 *     NotFoundError (404), RateLimitError (429), ServerError (5xx)
 *   ConnectionError (network failure), TimeoutError (per-attempt timeout)
 *   SignatureVerificationError, WebhookParseError
 *   ValidationError (invalid arguments, detected before any HTTP request)
 */

/** Minimal view of response headers (a `Headers` object satisfies it). */
export interface HeadersLike {
  get(name: string): string | null;
}

/** Base class of every error thrown by this SDK. */
export class ShieldLabsError extends Error {
  override name = 'ShieldLabsError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
  }
}

export interface ApiErrorOptions {
  status: number;
  /** Parsed response body: a JSON value when the body parses as JSON, the raw text otherwise, null when empty. */
  body?: unknown;
  headers?: HeadersLike | undefined;
  cause?: unknown;
}

const EMPTY_HEADERS: HeadersLike = { get: () => null };

/** The server answered with an error status (or a success status with an unusable body). */
export class ApiError extends ShieldLabsError {
  override name = 'ApiError';
  /** HTTP status code. */
  readonly status: number;
  /** Parsed response body: JSON value, raw text, or null when the body was empty. */
  readonly body: unknown;
  /** Response headers. */
  readonly headers: HeadersLike;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.body = options.body === undefined ? null : options.body;
    this.headers = options.headers ?? EMPTY_HEADERS;
  }
}

/** HTTP 400. */
export class BadRequestError extends ApiError {
  override name = 'BadRequestError';
}

/** HTTP 401 or 403: the key, secret or domain is wrong, or the domain is disabled. */
export class AuthenticationError extends ApiError {
  override name = 'AuthenticationError';
}

/**
 * HTTP 402. Neither the History API nor the Management API returns it today: an account over its
 * included volume keeps working and its profile shows a negative remaining count.
 */
export class QuotaExceededError extends ApiError {
  override name = 'QuotaExceededError';
}

/** HTTP 404: usually a wrong base URL or path. */
export class NotFoundError extends ApiError {
  override name = 'NotFoundError';
}

/** HTTP 429. */
export class RateLimitError extends ApiError {
  override name = 'RateLimitError';
  /** Seconds to wait, from the Retry-After header, when the server sent one. */
  readonly retryAfter: number | undefined;

  constructor(message: string, options: ApiErrorOptions & { retryAfter?: number | undefined }) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** HTTP 5xx, including gateway errors from edge proxies. */
export class ServerError extends ApiError {
  override name = 'ServerError';
}

/** The request never produced an HTTP response (DNS, TLS, connection reset, and so on). */
export class ConnectionError extends ShieldLabsError {
  override name = 'ConnectionError';
}

/** A request attempt took longer than the configured timeout. */
export class TimeoutError extends ShieldLabsError {
  override name = 'TimeoutError';
}

/** The X-Shield-Signature header is missing, malformed or does not match the body. */
export class SignatureVerificationError extends ShieldLabsError {
  override name = 'SignatureVerificationError';
}

/** The webhook body is authentic but is not a usable ShieldLabs event. */
export class WebhookParseError extends ShieldLabsError {
  override name = 'WebhookParseError';
}

/** An argument is invalid. Thrown before any HTTP request is sent. */
export class ValidationError extends ShieldLabsError {
  override name = 'ValidationError';
}
