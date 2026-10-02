import { DEFAULT_HISTORY_BASE_URL } from './constants.js';
import {
  ApiError,
  ConnectionError,
  RateLimitError,
  ServerError,
  type ShieldLabsError,
  TimeoutError,
  ValidationError,
} from './errors.js';
import { RATE_LIMIT_FLOOR_MS, RETRY_AFTER_CAP_MS, Transport, normalizeBaseUrl } from './http.js';
import { fromHistoryRow, isPlainObject } from './normalize.js';
import { sleep, throwIfAborted, warnIfBrowserPage, warnOnce } from './runtime.js';
import type { FetchLike, HistoryPage, Identification, LookupType } from './types.js';
import type { HistoryPath, HistoryQuery } from './wire.js';
import {
  validateBoolean,
  validateCredential,
  validateLookup,
  validateMilliseconds,
  validateNonNegativeInteger,
  validatePageSize,
  validateRequestId,
  type Lookup,
} from './validation.js';

/** Options of the History API client. */
export interface ShieldLabsOptions {
  /** Private API Key of the domain (sec_...). Keep it on your server. */
  apiKey: string;
  /** Origin of the History API. Default https://account.shieldlabs.ai. A trailing /api is removed. */
  baseUrl?: string | undefined;
  /** Timeout of one HTTP attempt in milliseconds. Default 10 000. */
  timeout?: number | undefined;
  /** Retries for connection errors, timeouts, 429 and 5xx. Default 2. */
  maxRetries?: number | undefined;
  /** Custom fetch implementation. Default: the global fetch. */
  fetch?: FetchLike | undefined;
  /**
   * Accept a plain http `baseUrl` on a host other than localhost, 127.0.0.1 or [::1], for a test
   * server. The key then travels unencrypted. Default false.
   */
  allowInsecureHttp?: boolean | undefined;
}

/** Options of `history.search`. */
export interface SearchOptions {
  /** Page size from 1 to 100. Default 20. */
  limit?: HistoryQuery['limit'];
  /** Number of rows to skip. Default 0. */
  offset?: HistoryQuery['offset'];
  signal?: AbortSignal | undefined;
}

/** Options of `history.iterate`. */
export interface IterateOptions {
  /** Rows per request from 1 to 100. Default 100. */
  pageSize?: HistoryQuery['limit'];
  /** Stop after this many identifications. Default: no limit. */
  maxItems?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** Options of `identifications.get`. */
export interface GetIdentificationOptions {
  /** Poll until the identification appears (true) or read once (false). Default true. */
  wait?: boolean | undefined;
  /**
   * Total time budget of the wait in milliseconds, counted from the call. Default 10 000. The
   * last poll runs at this deadline. Each poll is one HTTP attempt whose timeout is the client
   * timeout, shortened to the time left but never below 1 second, so the last poll can end up
   * to 1 second after the deadline. Pass `signal` (for example `AbortSignal.timeout(11_000)`)
   * for a hard limit that also cancels a request in flight.
   */
  timeout?: number | undefined;
  /**
   * Base wait between polls in milliseconds. The waits are 1, 2, 4 and 6 times this value, then 8
   * times it for every later wait, each capped at 2 000 or at this value when it is longer.
   * Default 250, which gives waits of 250, 500, 1 000, 1 500 and then 2 000; 1 000 gives 1 000
   * and then 2 000; 3 000 gives 3 000 every time.
   */
  pollInterval?: number | undefined;
  signal?: AbortSignal | undefined;
}

const API_KEY_FORMAT = /^sec_[a-z0-9]{8}-[a-z0-9]{8}-[a-z0-9]{8}$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
/** Cap of every wait between polls, unless `pollInterval` is longer: then that is the cap. */
const POLL_WAIT_CAP_MS = 2_000;
/** Multiples of `pollInterval` for the waits after the first four polls. */
const POLL_WAIT_FACTORS = [1, 2, 4, 6] as const;
/** Multiple of `pollInterval` for every later wait. */
const LAST_POLL_WAIT_FACTOR = 8;
/** Shortest attempt timeout of a poll, even when less time is left before the deadline. */
const MIN_POLL_ATTEMPT_MS = 1_000;

/**
 * The scheduled wait after poll number `index` (0 for the first poll): `pollInterval` times 1, 2,
 * 4 and 6, then 8 times it for every later wait, each capped at max(2 s, `pollInterval`). The
 * default 250 ms gives 250, 500, 1 000, 1 500 and then 2 000 ms; 1 s gives 1 s and then 2 s;
 * 3 s gives 3 s every time.
 */
export function pollWait(index: number, pollInterval: number): number {
  const factor = POLL_WAIT_FACTORS[index] ?? LAST_POLL_WAIT_FACTOR;
  return Math.min(Math.max(POLL_WAIT_CAP_MS, pollInterval), pollInterval * factor);
}

function parsePage(body: unknown, status: number, headers: ApiError['headers']): HistoryPage {
  if (!isPlainObject(body) || !Array.isArray(body.data)) {
    throw new ApiError('History API returned an unexpected response body.', {
      status,
      body,
      headers,
    });
  }
  const data = body.data.filter(isPlainObject).map(fromHistoryRow);
  const total =
    typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : data.length;
  return { data, total };
}

/**
 * One validated History request. `maxRetries` overrides the client setting and `attemptTimeout`
 * caps the client timeout when given.
 */
async function fetchPage(
  transport: Transport,
  lookup: Lookup,
  limit: NonNullable<HistoryQuery['limit']>,
  offset: NonNullable<HistoryQuery['offset']>,
  signal: AbortSignal | undefined,
  maxRetries?: number,
  attemptTimeout?: number,
): Promise<HistoryPage> {
  const pathParams: HistoryPath = { search_type: lookup.type, value: lookup.segment };
  const query: HistoryQuery = { limit, offset };
  const path = `/api/v1/history/${pathParams.search_type}/${pathParams.value}`;
  const response = await transport.getJson(path, {
    query: { limit: String(query.limit), offset: String(query.offset) },
    signal,
    maxRetries,
    timeout: attemptTimeout,
  });
  return parsePage(response.body, response.status, response.headers);
}

/** Errors a later poll can get past: 429, 5xx, connection failures and attempt timeouts. */
function isTransientPollError(error: unknown): error is ShieldLabsError {
  return (
    error instanceof RateLimitError ||
    error instanceof ServerError ||
    error instanceof ConnectionError ||
    error instanceof TimeoutError
  );
}

/** Reads identifications from the History API. */
export class HistoryResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * One page of identifications for one identifier, newest first.
   * `GET /api/v1/history/{type}/{value}`.
   */
  async search(
    type: LookupType,
    value: HistoryPath['value'],
    options: SearchOptions = {},
  ): Promise<HistoryPage> {
    const lookup = validateLookup(type, value);
    const limit = validatePageSize(options.limit ?? DEFAULT_LIMIT, 'limit');
    const offset = validateNonNegativeInteger(options.offset ?? 0, 'offset');
    return fetchPage(this.#transport, lookup, limit, offset, options.signal);
  }

  /**
   * Every identification for one identifier, newest first, fetched page by page. Rows repeated
   * across pages (new rows can shift offsets) are skipped by request ID. Stops at `total`, at an
   * empty page or after `maxItems`.
   */
  iterate(
    type: LookupType,
    value: HistoryPath['value'],
    options: IterateOptions = {},
  ): AsyncGenerator<Identification, void, undefined> {
    const lookup = validateLookup(type, value);
    const pageSize = validatePageSize(options.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize');
    const maxItems =
      options.maxItems === undefined
        ? undefined
        : validateNonNegativeInteger(options.maxItems, 'maxItems');
    return this.#iterate(lookup, pageSize, maxItems, options.signal);
  }

  async *#iterate(
    lookup: Lookup,
    pageSize: number,
    maxItems: number | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<Identification, void, undefined> {
    const seen = new Set<string>();
    let offset = 0;
    let yielded = 0;
    for (;;) {
      if (maxItems !== undefined && yielded >= maxItems) return;
      const page = await fetchPage(this.#transport, lookup, pageSize, offset, signal);
      if (page.data.length === 0) return;
      for (const identification of page.data) {
        const key = identification.request_id;
        if (key !== '') {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        yield identification;
        yielded++;
        if (maxItems !== undefined && yielded >= maxItems) return;
      }
      offset += page.data.length;
      if (offset >= page.total) return;
    }
  }
}

/** Reads single identifications by request ID. */
export class IdentificationsResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * The identification with this request ID, or null when none is found.
   *
   * Scoring is asynchronous: the row appears about 1 to 3 seconds after the browser call and can
   * be refined for up to about 10 seconds while follow-up checks finish; this returns the first
   * version it sees. With `wait` (the default), `timeout` is the total budget of the call:
   *
   * - The first poll runs at once. The waits between polls are `pollInterval` times 1, 2, 4 and 6,
   *   then 8 times it for every later wait, each capped at max(2 s, `pollInterval`): 250 ms,
   *   500 ms, 1 s, 1.5 s and then every 2 s by default, and every 3 s for a `pollInterval` of
   *   3 s. A wait that would pass the deadline is cut short, so the last poll runs at the
   *   deadline.
   * - Each poll is one HTTP attempt without retries, with the timeout
   *   min(client timeout, max(time left, 1 s)).
   * - 429, 5xx, connection errors and timeouts do not end the wait. After a 429 the next wait is
   *   the longest of the scheduled wait, 1 s and the Retry-After capped at 10 s (a missing
   *   Retry-After, 0 or a past date counts as 0), cut short at the deadline like any other wait.
   *   When the capped Retry-After is longer than the time left, that RateLimitError is thrown at
   *   once.
   * - At the deadline, the error of the last poll is thrown if it failed; otherwise the result
   *   is null.
   * - 400, 401, 403 and 404 (and any other error that another poll cannot fix) are thrown at once.
   */
  async get(
    requestId: string,
    options: GetIdentificationOptions = {},
  ): Promise<Identification | null> {
    const id = validateRequestId(requestId);
    const wait = validateBoolean(options.wait ?? true, 'wait');
    const timeout = validateMilliseconds(
      options.timeout ?? DEFAULT_WAIT_TIMEOUT_MS,
      'timeout',
      true,
    );
    const pollInterval = validateMilliseconds(
      options.pollInterval ?? DEFAULT_POLL_INTERVAL_MS,
      'pollInterval',
    );
    const { signal } = options;
    throwIfAborted(signal);
    const lookup: Lookup = { type: 'request_id', value: id, segment: id };

    if (!wait) {
      const page = await fetchPage(this.#transport, lookup, 1, 0, signal);
      return page.data[0] ?? null;
    }
    return this.#poll(lookup, Date.now() + timeout, pollInterval, signal);
  }

  async #poll(
    lookup: Lookup,
    deadline: number,
    pollInterval: number,
    signal: AbortSignal | undefined,
  ): Promise<Identification | null> {
    let atDeadline = false;
    for (let index = 0; ; index++) {
      const attemptTimeout = Math.min(
        this.#transport.timeout,
        Math.max(deadline - Date.now(), MIN_POLL_ATTEMPT_MS),
      );
      let failure: ShieldLabsError | undefined;
      try {
        const page = await fetchPage(this.#transport, lookup, 1, 0, signal, 0, attemptTimeout);
        const found = page.data[0];
        if (found) return found;
      } catch (error) {
        throwIfAborted(signal);
        if (!isTransientPollError(error)) throw error;
        failure = error;
      }

      const remaining = deadline - Date.now();
      if (atDeadline || remaining <= 0) {
        if (failure !== undefined) throw failure;
        return null;
      }

      let delay = pollWait(index, pollInterval);
      if (failure instanceof RateLimitError) {
        // No Retry-After counts as 0, like "Retry-After: 0" or a past date: the 1 s floor applies.
        const retryAfter = Math.min((failure.retryAfter ?? 0) * 1000, RETRY_AFTER_CAP_MS);
        // Retry-After asks for more time than is left: no later poll fits before the deadline.
        if (retryAfter > remaining) throw failure;
        delay = Math.max(delay, RATE_LIMIT_FLOOR_MS, retryAfter);
      }
      if (delay >= remaining) {
        delay = remaining;
        atDeadline = true;
      }
      await sleep(delay, signal);
    }
  }
}

/**
 * Client for the History API (`https://account.shieldlabs.ai`), authenticated with the Private
 * API Key of one domain. Stateless apart from its configuration, so one instance can be shared
 * by concurrent requests.
 */
export class ShieldLabs {
  /** Single identifications by request ID, with wait-for-verdict polling. */
  readonly identifications: IdentificationsResource;
  /** History lookups by identifier. */
  readonly history: HistoryResource;

  constructor(options: ShieldLabsOptions) {
    if (!isPlainObject(options)) {
      throw new ValidationError('new ShieldLabs() needs an options object with apiKey.');
    }
    const apiKey = validateCredential(options.apiKey, 'apiKey');
    warnIfBrowserPage('ShieldLabs', 'Private API Key');
    if (!API_KEY_FORMAT.test(apiKey)) {
      warnOnce(
        'api-key-format',
        'apiKey does not look like a Private API Key (sec_xxxxxxxx-xxxxxxxx-xxxxxxxx). The History API needs the Private API Key, not the Public Key or the Secret Key.',
      );
    }
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? DEFAULT_HISTORY_BASE_URL,
      'baseUrl',
      true,
      validateBoolean(options.allowInsecureHttp ?? false, 'allowInsecureHttp'),
    );
    const timeout = validateMilliseconds(options.timeout ?? DEFAULT_TIMEOUT_MS, 'timeout');
    const maxRetries = validateNonNegativeInteger(
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
      'maxRetries',
    );
    if (options.fetch !== undefined && typeof options.fetch !== 'function') {
      throw new ValidationError('fetch must be a function.');
    }
    const transport = new Transport({
      apiName: 'History API',
      baseUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
      secrets: [apiKey],
      timeout,
      maxRetries,
      retryRateLimited: true,
      fetch: options.fetch,
    });
    this.history = new HistoryResource(transport);
    this.identifications = new IdentificationsResource(transport);
  }
}
