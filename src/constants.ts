import type { DetectionFlags, LookupType, RiskBand } from './types.js';

/** The all-zero UUID. As a device ID it means "no usable device signals". */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Known risk signal slugs (`IdentificationSignal.name`). Signal names are an open set: new slugs
 * can appear at any time, so compare against these constants and never treat them as exhaustive.
 */
export const SIGNALS = Object.freeze({
  TOR: 'tor',
  JAVASCRIPT_DISABLED: 'javascript_disabled',
  OS_MISMATCH: 'os_mismatch',
  ANTIDETECT_BROWSER: 'antidetect_browser',
  PROXY_ROUTED_ANTIDETECT: 'proxy_routed_antidetect',
  PORT_SCAN_ROUTED_VIA_PROXY: 'port_scan_routed_via_proxy',
  BROWSER_AUTOMATION: 'browser_automation',
  STUN_NOT_CHECKED: 'stun_not_checked',
  STUN_LATE_CORRECTION: 'stun_late_correction',
  OS_NOT_DETECTED: 'os_not_detected',
  BROWSER_VPN_PROXY: 'browser_vpn_proxy',
  VPN: 'vpn',
  PRIVACY_RELAY: 'privacy_relay',
  PROXY: 'proxy',
  DATACENTER_IP: 'datacenter_ip',
  ABUSER: 'abuser',
  TIMEZONE_MISMATCH: 'timezone_mismatch',
  RATE_LIMITED: 'rate_limited',
} as const);

/** A known signal slug. */
export type KnownSignal = (typeof SIGNALS)[keyof typeof SIGNALS];

/** Score ranges of the three risk bands (inclusive). */
export const RISK_BANDS = Object.freeze({
  trusted: Object.freeze({ min: 0, max: 29 }),
  suspicious: Object.freeze({ min: 30, max: 59 }),
  dangerous: Object.freeze({ min: 60, max: 100 }),
} as const);

export const RISK_BAND_NAMES: readonly RiskBand[] = ['trusted', 'suspicious', 'dangerous'];

export const LOOKUP_TYPES: readonly LookupType[] = [
  'ip',
  'user_hid',
  'visitor_id',
  'request_id',
  'device_id',
  'session_id',
  'cookie_id',
];

export type FlagKey = keyof DetectionFlags;

/** The 19 detection flag keys, in the order the webhook payload lists them. */
export const FLAG_KEYS: readonly FlagKey[] = [
  'vpn',
  'privacy_relay',
  'browser_vpn_proxy',
  'tor',
  'proxy',
  'datacenter_ip',
  'abuser',
  'os_mismatch',
  'os_not_detected',
  'timezone_mismatch',
  'anti_detect_browser',
  'browser_automation',
  'ip_mismatch',
  'incognito',
  'search_bot',
  'suspicious_paid_click',
  'javascript_disabled',
  'stun_not_checked',
  'check_incomplete',
];

/** Webhook schema version this SDK was built for. */
export const KNOWN_SCHEMA_VERSION = '2026-06-01';

export const DEFAULT_HISTORY_BASE_URL = 'https://account.shieldlabs.ai';
export const DEFAULT_MANAGEMENT_BASE_URL = 'https://api.shieldlabs.ai';
