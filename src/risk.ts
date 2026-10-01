import { FLAG_KEYS, NIL_UUID, RISK_BAND_NAMES, type FlagKey } from './constants.js';
import { ValidationError } from './errors.js';
import type { DetectionFlags, Identification, RiskBand } from './types.js';

/**
 * Risk band for a Risk Score: trusted 0-29, suspicious 30-59, dangerous 60-100.
 * A score above 100 (the 999 marker) is not a score: it returns "rate_limited".
 */
export function riskBand(score: number): RiskBand | 'rate_limited' {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    throw new ValidationError('riskBand() needs a numeric Risk Score.');
  }
  if (score > 100) return 'rate_limited';
  if (score >= 60) return 'dangerous';
  if (score >= 30) return 'suspicious';
  return 'trusted';
}

/** True for the rate-limit marker (a Risk Score above 100, sent as 999). */
export function isRateLimited(score: number): boolean {
  return typeof score === 'number' && score > 100;
}

/** Why an identification did not pass `evaluateIdentification`. */
export type EvaluationReason =
  | 'missing'
  | 'replayed'
  | 'stale'
  | 'rate_limited'
  | 'no_device_signals'
  | 'blocked_flag'
  | 'blocked_band';

/** Result of `evaluateIdentification`. */
export interface Evaluation {
  /** True when every check passed. */
  ok: boolean;
  /** The first check that failed, or null when `ok` is true. */
  reason: EvaluationReason | null;
  /** Band of the Risk Score ("rate_limited" for the 999 marker), or null when the identification is missing. */
  band: RiskBand | 'rate_limited' | null;
  /** The detection flag that failed the check, when `reason` is "blocked_flag". */
  flag?: keyof DetectionFlags;
}

/** Options of `evaluateIdentification`. The defaults are a starting point to tune. */
export interface EvaluateOptions {
  /**
   * Maximum age of the identification in milliseconds, measured from `observed_at`. Default
   * 300 000 (5 minutes). `Infinity` skips the freshness check.
   */
  maxAge?: number | undefined;
  /** Current time (Date or epoch milliseconds). Default: now. */
  now?: Date | number | undefined;
  /** Bands that fail the check. Default ["dangerous"]. */
  blockBands?: readonly RiskBand[] | undefined;
  /** Detection flags that fail the check. Default ["browser_automation", "javascript_disabled"]. */
  blockFlags?: readonly (keyof DetectionFlags)[] | undefined;
  /**
   * Returns true when this request ID was already used for a protected action. The SDK keeps
   * no state: claim the request ID in your own store first (an atomic insert-if-absent) and
   * return the result here. Must return a boolean synchronously.
   */
  isReplay?: ((requestId: string) => boolean) | undefined;
}

const DEFAULT_MAX_AGE_MS = 300_000;
const DEFAULT_BLOCK_BANDS: readonly RiskBand[] = ['dangerous'];
const DEFAULT_BLOCK_FLAGS: readonly FlagKey[] = ['browser_automation', 'javascript_disabled'];

function resolveNow(now: Date | number | undefined): number {
  if (now === undefined) return Date.now();
  const value = now instanceof Date ? now.getTime() : now;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('now must be a valid Date or a number of epoch milliseconds.');
  }
  return value;
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Applies a reusable guard policy to an identification. Checks run in this order and the first
 * failure wins: missing identification, replayed request ID (`isReplay`), older than `maxAge`,
 * rate-limit marker, all-zero device ID, a flag in `blockFlags`, a band in `blockBands`.
 */
export function evaluateIdentification(
  identification: Identification | null | undefined,
  options: EvaluateOptions = {},
): Evaluation {
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE_MS;
  if (typeof maxAge !== 'number' || Number.isNaN(maxAge) || maxAge < 0) {
    throw new ValidationError(
      'maxAge must be a number of milliseconds greater than or equal to 0, or Infinity to skip the freshness check.',
    );
  }
  const nowMs = resolveNow(options.now);
  const blockBands = options.blockBands ?? DEFAULT_BLOCK_BANDS;
  for (const band of blockBands) {
    if (!RISK_BAND_NAMES.includes(band)) {
      throw new ValidationError(
        `Unknown risk band in blockBands. Use one of: ${RISK_BAND_NAMES.join(', ')}.`,
      );
    }
  }
  const blockFlags = options.blockFlags ?? DEFAULT_BLOCK_FLAGS;
  for (const flag of blockFlags) {
    if (!FLAG_KEYS.includes(flag)) {
      throw new ValidationError(
        `Unknown detection flag in blockFlags. Use one of: ${FLAG_KEYS.join(', ')}.`,
      );
    }
  }

  if (identification === null || identification === undefined) {
    return { ok: false, reason: 'missing', band: null };
  }

  const band = riskBand(identification.risk_score);

  if (options.isReplay) {
    const replayed: unknown = options.isReplay(identification.request_id);
    if (isThenable(replayed)) {
      throw new ValidationError(
        'isReplay must return a boolean synchronously. Claim the request ID in your store first (an atomic insert-if-absent), then pass the result, for example isReplay: () => !claimed.',
      );
    }
    if (replayed) return { ok: false, reason: 'replayed', band };
  }

  if (maxAge !== Number.POSITIVE_INFINITY) {
    const observedMs =
      identification.observed_at === null ? Number.NaN : Date.parse(identification.observed_at);
    if (Number.isNaN(observedMs) || nowMs - observedMs > maxAge) {
      return { ok: false, reason: 'stale', band };
    }
  }

  if (isRateLimited(identification.risk_score)) {
    return { ok: false, reason: 'rate_limited', band };
  }

  if (!identification.device_id || identification.device_id === NIL_UUID) {
    return { ok: false, reason: 'no_device_signals', band };
  }

  for (const flag of blockFlags) {
    if (identification.detection_flags[flag]) {
      return { ok: false, reason: 'blocked_flag', band, flag };
    }
  }

  if (band !== 'rate_limited' && blockBands.includes(band)) {
    return { ok: false, reason: 'blocked_band', band };
  }

  return { ok: true, reason: null, band };
}
