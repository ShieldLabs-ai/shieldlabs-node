/**
 * Normalization of History API rows and webhook `data` objects into one `Identification` shape.
 *
 * This module follows the shared normalization rules used by every ShieldLabs server SDK,
 * including their edge cases (truthiness of flag values, whitespace trimming rules and
 * timestamp handling), so that all SDKs produce identical results for identical input.
 * The only intentional differences are type guarantees: a value of the wrong JSON type becomes
 * "" (strings), 0 (weights) or NaN (scores) instead of being passed through.
 */
import { FLAG_KEYS, type FlagKey } from './constants.js';
import type {
  DetectionFlags,
  DomainProfile,
  Identification,
  IdentificationSignal,
  IpInfo,
  TrafficSource,
} from './types.js';
import type { HistoryRow, ScoreDetail, ScoredData, WireKeys } from './wire.js';

export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(obj: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Own property value, or undefined when the key is absent. */
function own(obj: JsonObject, key: string): unknown {
  return hasOwn(obj, key) ? obj[key] : undefined;
}

/** A string property, or "" when it is absent or not a string. */
function stringField(obj: JsonObject, key: string): string {
  const value = own(obj, key);
  return typeof value === 'string' ? value : '';
}

/** Truthiness as defined by the shared rules: empty strings, arrays and objects, 0 and null are false. */
export function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

// Unicode whitespace as defined by the shared rules. Differs from String.prototype.trim():
// it includes U+001C to U+001F and U+0085, and excludes U+FEFF.
const WHITESPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);

/** Trims whitespace (as defined above) from both ends. */
export function stripWhitespace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && WHITESPACE.has(text.charCodeAt(start))) start++;
  while (end > start && WHITESPACE.has(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

function stripUnderscores(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === '_') start++;
  while (end > start && text[end - 1] === '_') end--;
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------------------------
// Signal slugs
// ---------------------------------------------------------------------------------------------

const EXACT_SLUGS = new Map<string, string>([
  ['Is tor', 'tor'],
  ['Is VPN', 'vpn'],
  ['Is privacy relay', 'privacy_relay'],
  ['Is proxy', 'proxy'],
  ['Is datacenter', 'datacenter_ip'],
  ['Is abuser', 'abuser'],
  ['Stun is not checked', 'stun_not_checked'],
  ['Stun passed (late arrival, corrected)', 'stun_late_correction'],
  ['UA OS is not detected', 'os_not_detected'],
  ['Network OS is not detected', 'os_not_detected'],
  ['Browser timezone ≠ IP-timezone', 'timezone_mismatch'],
  ['Browser VPN/Proxy', 'browser_vpn_proxy'],
  ['Browser Automation', 'browser_automation'],
  ['Port scan routed via proxy (antidetect browser pattern)', 'proxy_routed_antidetect'],
  ['User has been banned 1H, to many requests', 'rate_limited'],
]);

const PREFIX_SLUGS: ReadonlyArray<readonly [prefix: string, slug: string]> = [
  ['Antidetect browser', 'antidetect_browser'],
  ['Os_mismatch', 'os_mismatch'],
  ['OS mismatch2', 'os_mismatch2'],
  ['TCP handshake', 'tcp_handshake_v2'],
  ['Latency test', 'ws_tcp_latency'],
  ['JavaScript disabled', 'javascript_disabled'],
];

const STICKY_PREFIX = 'Sticky verdict: ';
const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u;

/**
 * Slug for a description without an explicit mapping: the text before the first "(",
 * lowercased, with spaces, "-" and "/" collapsed to "_", "≠" written as "_neq_" and any other
 * punctuation dropped.
 */
export function fallbackSlug(description: string): string {
  let text = stripWhitespace(description);
  const paren = text.indexOf('(');
  if (paren >= 0) text = stripWhitespace(text.slice(0, paren));
  let out = '';
  let previousWasSeparator = false;
  for (const ch of text) {
    if (ch === ' ' || ch === '-' || ch === '/') {
      if (!previousWasSeparator && out.length > 0) {
        out += '_';
        previousWasSeparator = true;
      }
    } else if (ch === '≠') {
      out += '_neq_';
      previousWasSeparator = false;
    } else if (LETTER_OR_DIGIT.test(ch)) {
      out += ch.toLowerCase();
      previousWasSeparator = false;
    }
  }
  const slug = stripUnderscores(out);
  return slug === '' ? 'unknown' : slug;
}

/** Signal slug for a History `score_details` description (the webhook `signals[].name`). */
export function signalSlug(description: string): string {
  const exact = EXACT_SLUGS.get(description);
  if (exact !== undefined) return exact;
  for (const [prefix, slug] of PREFIX_SLUGS) {
    if (description.startsWith(prefix)) return slug;
  }
  if (description.startsWith(STICKY_PREFIX)) {
    const colon = description.indexOf(':');
    const rest =
      colon >= 0 && colon + 1 < description.length
        ? stripWhitespace(description.slice(colon + 1))
        : description;
    return fallbackSlug(rest);
  }
  return fallbackSlug(description);
}

// ---------------------------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------------------------

// History rows: "YYYY-MM-DD HH:MM:SS[.fff]" in UTC. A zone designator is accepted and ignored.
const HISTORY_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:?\d{2})?$/;
// Webhooks and the Management API: RFC 3339 with up to 9 fractional digits. A single trailing
// newline is tolerated.
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})\n?$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Formats matched date parts as "YYYY-MM-DDTHH:MM:SS.mmmZ" after applying the offset. The
 * fraction is truncated to milliseconds (never rounded). Returns null for impossible dates.
 */
function formatUtc(match: RegExpMatchArray, offsetMinutes: number): string | null {
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) =>
    Number(match[i]),
  ) as [number, number, number, number, number, number];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  const utc = new Date(local.getTime() - offsetMinutes * 60_000);
  const utcYear = utc.getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) return null;
  const millis = (match[7] ?? '0').slice(0, 3).padEnd(3, '0');
  return (
    `${pad(utcYear, 4)}-${pad(utc.getUTCMonth() + 1, 2)}-${pad(utc.getUTCDate(), 2)}` +
    `T${pad(utc.getUTCHours(), 2)}:${pad(utc.getUTCMinutes(), 2)}:${pad(utc.getUTCSeconds(), 2)}` +
    `.${millis}Z`
  );
}

/** History `created_at` ("YYYY-MM-DD HH:MM:SS[.fff]", UTC) to RFC 3339 with milliseconds. */
export function parseHistoryTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = stripWhitespace(value);
  if (text === '') return null;
  const match = text.match(HISTORY_TIME);
  return match ? formatUtc(match, 0) : null;
}

/** RFC 3339 timestamp (up to 9 fractional digits, any offset) to UTC with milliseconds. */
export function parseRfc3339(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(RFC3339);
  if (!match) return null;
  const zone = match[8] ?? 'Z';
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone.startsWith('+') ? 1 : -1;
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  }
  return formatUtc(match, offsetMinutes);
}

// ---------------------------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------------------------

type HistoryFlagKey = Exclude<FlagKey, 'browser_vpn_proxy' | 'ip_mismatch'>;

const HISTORY_FLAG_COLUMNS: Readonly<Record<HistoryFlagKey, WireKeys<HistoryRow, boolean>>> = {
  vpn: 'is_vpn',
  privacy_relay: 'is_privacy_relay',
  tor: 'is_tor',
  proxy: 'is_proxy',
  datacenter_ip: 'is_datacenter',
  abuser: 'is_abuser',
  os_mismatch: 'is_os_mismatch',
  os_not_detected: 'is_os_not_detected',
  timezone_mismatch: 'is_timezone_mismatch',
  anti_detect_browser: 'is_antidetect',
  browser_automation: 'is_browser_automation',
  incognito: 'is_incognito',
  search_bot: 'is_search_bot',
  suspicious_paid_click: 'is_suspicious_paid_click',
  javascript_disabled: 'is_js_disabled',
  stun_not_checked: 'is_stun_not_checked',
  check_incomplete: 'check_incomplete',
};

/** IP sentinel handling: trimmed, and "0.0.0.0" means no IP (""). */
function normalizeIp(value: unknown): string {
  if (typeof value !== 'string') return '';
  const ip = stripWhitespace(value);
  return ip === '0.0.0.0' ? '' : ip;
}

/** "" and null become null; other User HID values (including sentinels) are kept. */
function normalizeUserHid(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Score as sent; absent means 0, a non-numeric value becomes NaN (never a valid score). */
function normalizeScore(obj: JsonObject, key: string): number {
  if (!hasOwn(obj, key)) return 0;
  const value = obj[key];
  return typeof value === 'number' ? value : Number.NaN;
}

// JSON is untrusted even when an HTTP operation has generated types. These readers check
// column names and expected wire types at compile time, while retaining runtime fallbacks
// for missing or malformed fields and keeping unknown fields in `raw`.
const historyField: (obj: JsonObject, key: WireKeys<HistoryRow>) => unknown = own;
const historyString: (obj: JsonObject, key: WireKeys<HistoryRow, string>) => string = stringField;
const historyScore: (obj: JsonObject, key: WireKeys<HistoryRow, number>) => number = normalizeScore;
const webhookField: (obj: JsonObject, key: WireKeys<ScoredData>) => unknown = own;
const webhookString: (obj: JsonObject, key: WireKeys<ScoredData, string>) => string = stringField;
const webhookScore: (obj: JsonObject, key: WireKeys<ScoredData, number>) => number = normalizeScore;
const detailString: (obj: JsonObject, key: WireKeys<ScoreDetail, string>) => string = stringField;
const detailNumber: (obj: JsonObject, key: WireKeys<ScoreDetail, number>) => unknown = own;

/** Parses the JSON-encoded `score_details` string. "" or invalid JSON gives an empty list. */
function parseScoreDetails(value: unknown): unknown[] {
  const text = isTruthy(value) ? value : '[]';
  if (typeof text !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ipInfo(value: unknown): IpInfo {
  const obj = isPlainObject(value) ? value : {};
  return { ip: normalizeIp(own(obj, 'ip')), country: stringField(obj, 'country') };
}

const TRAFFIC_KEYS: ReadonlyArray<keyof TrafficSource> = [
  'channel',
  'referrer_domain',
  'landing_url',
  'click_id_type',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

/** Builds an Identification from one History API row. */
export function fromHistoryRow(row: JsonObject): Identification {
  const leakSource = stripWhitespace(historyString(row, 'webrtc_leak_source'));
  let localIp: string;
  let localCountry: string;
  if (leakSource !== '' && leakSource !== 'none') {
    localIp = normalizeIp(historyField(row, 'webrtc_leak_ip'));
    localCountry = historyString(row, 'webrtc_leak_country');
  } else {
    localIp = normalizeIp(historyField(row, 'web_rtc_ip'));
    localCountry = historyString(row, 'web_rtc_country');
  }
  const publicIp = normalizeIp(historyField(row, 'ip'));

  const signals: IdentificationSignal[] = [];
  let ipLeakDetail = false;
  for (const entry of parseScoreDetails(historyField(row, 'score_details'))) {
    if (!isPlainObject(entry)) continue;
    const description = detailString(entry, 'Description');
    if (description.startsWith('IP ≠ leakIP')) ipLeakDetail = true;
    const value = detailNumber(entry, 'Value');
    if (typeof value !== 'number' || !Number.isInteger(value) || value === 0) continue;
    signals.push({ name: signalSlug(description), weight: value, description });
  }

  const searchBot = isTruthy(historyField(row, 'is_search_bot'));
  const flags = {} as DetectionFlags;
  for (const key of FLAG_KEYS) {
    if (key === 'browser_vpn_proxy') {
      flags[key] = historyField(row, 'connection_type') === 'browser_vpn_proxy';
    } else if (key === 'ip_mismatch') {
      flags[key] =
        !searchBot && (ipLeakDetail || (publicIp !== '' && localIp !== '' && publicIp !== localIp));
    } else {
      flags[key] = isTruthy(historyField(row, HISTORY_FLAG_COLUMNS[key]));
    }
  }

  const siteDomain = historyField(row, 'site_domain');
  let domain: string;
  if (isTruthy(siteDomain)) {
    domain = typeof siteDomain === 'string' ? siteDomain : '';
  } else {
    domain = historyString(row, 'domain');
  }

  return {
    request_id: historyString(row, 'request_id'),
    visitor_id: historyString(row, 'visitor_id'),
    device_id: historyString(row, 'device_id'),
    session_id: historyString(row, 'session_id'),
    cookie_id: historyString(row, 'cookie_id'),
    user_hid: normalizeUserHid(historyField(row, 'user_hid')),
    domain,
    public_ip: { ip: publicIp, country: historyString(row, 'country') },
    local_ip: { ip: localIp, country: localCountry },
    connection_type: historyString(row, 'connection_type'),
    os: historyString(row, 'os'),
    browser: historyString(row, 'browser'),
    device_type: historyString(row, 'device_type'),
    traffic_source: {
      channel: historyString(row, 'traffic_channel'),
      referrer_domain: historyString(row, 'referrer_domain'),
      landing_url: historyString(row, 'entry_url'),
      click_id_type: historyString(row, 'click_id_type'),
      utm_source: historyString(row, 'utm_source'),
      utm_medium: historyString(row, 'utm_medium'),
      utm_campaign: historyString(row, 'utm_campaign'),
      utm_content: historyString(row, 'utm_content'),
      utm_term: historyString(row, 'utm_term'),
    },
    risk_score: historyScore(row, 'score'),
    signals,
    detection_flags: flags,
    observed_at: parseHistoryTime(historyField(row, 'created_at')),
    source: 'history',
    raw: row,
  };
}

/** Builds an Identification from the `data` object of an `identification.scored` webhook. */
export function fromWebhookData(data: JsonObject): Identification {
  const rawFlags = webhookField(data, 'detection_flags');
  const flagSource = isPlainObject(rawFlags) ? rawFlags : {};
  const flags = {} as DetectionFlags;
  for (const key of FLAG_KEYS) flags[key] = isTruthy(own(flagSource, key));

  const rawTraffic = webhookField(data, 'traffic_source');
  const trafficSource = isPlainObject(rawTraffic) ? rawTraffic : {};
  const traffic = {} as TrafficSource;
  for (const key of TRAFFIC_KEYS) traffic[key] = stringField(trafficSource, key);

  const rawSignals = webhookField(data, 'signals');
  const signals: IdentificationSignal[] = Array.isArray(rawSignals)
    ? rawSignals.filter(isPlainObject).map((signal) => {
        const weight = own(signal, 'weight');
        return {
          name: stringField(signal, 'name'),
          weight: typeof weight === 'number' ? weight : 0,
          description: null,
        };
      })
    : [];

  return {
    request_id: webhookString(data, 'request_id'),
    visitor_id: webhookString(data, 'visitor_id'),
    device_id: webhookString(data, 'device_id'),
    session_id: webhookString(data, 'session_id'),
    cookie_id: webhookString(data, 'cookie_id'),
    user_hid: normalizeUserHid(webhookField(data, 'user_hid')),
    domain: webhookString(data, 'domain'),
    public_ip: ipInfo(webhookField(data, 'public_ip')),
    local_ip: ipInfo(webhookField(data, 'local_ip')),
    connection_type: webhookString(data, 'connection_type'),
    os: webhookString(data, 'os'),
    browser: webhookString(data, 'browser'),
    device_type: webhookString(data, 'device_type'),
    traffic_source: traffic,
    risk_score: webhookScore(data, 'risk_score'),
    signals,
    detection_flags: flags,
    observed_at: parseRfc3339(webhookField(data, 'observed_at')),
    source: 'webhook',
    raw: data,
  };
}

/** Builds a DomainProfile from a Management API profile response (PascalCase keys). */
export function profileFromResponse(body: JsonObject): DomainProfile {
  const weight = own(body, 'Weight');
  return {
    domain: stringField(body, 'Domain'),
    remaining_identifications: typeof weight === 'number' && Number.isFinite(weight) ? weight : 0,
    public_key_masked: stringField(body, 'PublicKey'),
    secret_key_masked: stringField(body, 'Secret'),
    created_at: parseRfc3339(own(body, 'CreatedAt')),
    raw: body,
  };
}
