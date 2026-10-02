import { DEFAULT_MANAGEMENT_BASE_URL } from './constants.js';
import { ApiError, ValidationError } from './errors.js';
import { Transport, normalizeBaseUrl } from './http.js';
import { isPlainObject, profileFromResponse } from './normalize.js';
import { warnIfBrowserPage } from './runtime.js';
import type { DomainProfile, FetchLike } from './types.js';
import type { ProfileHeaders } from './wire.js';
import {
  isAscii,
  requireHeaderSafe,
  validateBoolean,
  validateCredential,
  validateMilliseconds,
  validateNonNegativeInteger,
} from './validation.js';

/** Options of the Management API client. */
export interface ShieldLabsManagementOptions {
  /** Secret Key of the domain. Keep it on your server. */
  secretKey: string;
  /** The registered domain, for example "example.com". Normalized before it is sent. */
  domain: ProfileHeaders['X-Shield-Domain'];
  /** Origin of the Management API. Default https://api.shieldlabs.ai. */
  baseUrl?: string | undefined;
  /** Timeout of one HTTP attempt in milliseconds. Default 10 000. */
  timeout?: number | undefined;
  /** Retries for connection errors, timeouts and 5xx (never for 429). Default 2. */
  maxRetries?: number | undefined;
  /** Custom fetch implementation. Default: the global fetch. */
  fetch?: FetchLike | undefined;
  /**
   * Accept a plain http `baseUrl` on a host other than localhost, 127.0.0.1 or [::1], for a test
   * server. The Secret Key then travels unencrypted. Default false.
   */
  allowInsecureHttp?: boolean | undefined;
}

/** Options of `getProfile`. */
export interface GetProfileOptions {
  signal?: AbortSignal | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Normalizes a domain the way registered domains are stored: trimmed, lowercase, without scheme,
 * path, trailing slash or a leading "www.". The server matches the registered domain exactly.
 */
export function normalizeDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  domain = domain.split(/[/?#]/, 1)[0] ?? '';
  return domain.replace(/^www\./, '');
}

/**
 * Client for the Management API (`https://api.shieldlabs.ai`), authenticated with the Secret Key
 * and the registered domain. The API allows about 15 requests per minute per IP and then blocks
 * the IP for 10 minutes, so this client never retries a 429: call it sparingly and cache results.
 * Safe for concurrent use.
 */
export class ShieldLabsManagement {
  /** The normalized domain sent in X-Shield-Domain. */
  readonly domain: ProfileHeaders['X-Shield-Domain'];
  readonly #transport: Transport;

  constructor(options: ShieldLabsManagementOptions) {
    if (!isPlainObject(options)) {
      throw new ValidationError(
        'new ShieldLabsManagement() needs an options object with secretKey and domain.',
      );
    }
    const secretKey = validateCredential(options.secretKey, 'secretKey');
    warnIfBrowserPage('ShieldLabsManagement', 'Secret Key');
    if (typeof options.domain !== 'string') {
      throw new ValidationError('domain is required and must be a string such as "example.com".');
    }
    const domain = normalizeDomain(options.domain);
    if (domain === '') {
      throw new ValidationError('domain is required and must be a string such as "example.com".');
    }
    if (!isAscii(domain)) {
      throw new ValidationError('domain must be ASCII: pass the punycode form (xn--...).');
    }
    requireHeaderSafe(domain, 'domain');
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? DEFAULT_MANAGEMENT_BASE_URL,
      'baseUrl',
      false,
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
    this.domain = domain;
    const headers = {
      'X-Shield-Domain': domain,
      Authorization: `Bearer ${secretKey}`,
    } satisfies ProfileHeaders & { Authorization: string };
    this.#transport = new Transport({
      apiName: 'Management API',
      baseUrl,
      headers,
      secrets: [secretKey],
      timeout,
      maxRetries,
      retryRateLimited: false,
      fetch: options.fetch,
    });
  }

  /** The domain profile: remaining identifications and masked keys. `GET /v1/profile`. */
  async getProfile(options: GetProfileOptions = {}): Promise<DomainProfile> {
    const response = await this.#transport.getJson('/v1/profile', { signal: options.signal });
    if (!isPlainObject(response.body)) {
      throw new ApiError('Management API returned an unexpected response body.', {
        status: response.status,
        body: response.body,
        headers: response.headers,
      });
    }
    return profileFromResponse(response.body);
  }
}
