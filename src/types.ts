/** Identifier types the History API can search by. */
export type LookupType =
  'ip' | 'user_hid' | 'visitor_id' | 'request_id' | 'device_id' | 'session_id' | 'cookie_id';

/** The three risk bands: trusted 0-29, suspicious 30-59, dangerous 60-100. */
export type RiskBand = 'trusted' | 'suspicious' | 'dangerous';

/**
 * Connection type of an identification. Known values are listed; unknown strings are kept as sent.
 */
export type ConnectionType =
  | 'direct'
  | 'mobile'
  | 'vpn'
  | 'proxy'
  | 'tor'
  | 'privacy_relay'
  | 'browser_vpn_proxy'
  | 'unknown'
  | (string & {});

/** An IP address with its country. */
export interface IpInfo {
  /** Dotted IPv4 address, or "" when none is known. */
  ip: string;
  /** English country name (for example "Germany"), or "" when unknown. */
  country: string;
}

/** Where the visit came from. Every value is a string, "" when absent. */
export interface TrafficSource {
  channel: string;
  referrer_domain: string;
  landing_url: string;
  click_id_type: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
}

/** One weighted risk signal behind the Risk Score. Display and log these; branch on detection_flags. */
export interface IdentificationSignal {
  /** Signal slug, for example "vpn" or "antidetect_browser". An open set: see SIGNALS for known values. */
  name: string;
  /** Weight of the signal. Can be negative. Never sum weights yourself. */
  weight: number;
  /** Server description of the signal (History API rows only; null for webhooks). */
  description: string | null;
}

/** The 19 stable detection flags. A flag the server did not send is false. */
export interface DetectionFlags {
  /** Legacy only; current webhooks expose the combined os_mismatch. */
  os_mismatch2?: boolean;
  ai_bot?: boolean;
  ai_browser?: boolean;
  device_spoofing?: boolean;
  latency_test?: boolean;
  banned_ip?: boolean;
  vpn: boolean;
  privacy_relay: boolean;
  browser_vpn_proxy: boolean;
  tor: boolean;
  proxy: boolean;
  datacenter_ip: boolean;
  abuser: boolean;
  os_mismatch: boolean;
  os_not_detected: boolean;
  timezone_mismatch: boolean;
  anti_detect_browser: boolean;
  browser_automation: boolean;
  ip_mismatch: boolean;
  incognito: boolean;
  search_bot: boolean;
  suspicious_paid_click: boolean;
  javascript_disabled: boolean;
  stun_not_checked: boolean;
  check_incomplete: boolean;
}

/**
 * One identification (one run of the ShieldLabs agent in one browser), normalized from a
 * webhook `data` object or a History API row. Property names follow the webhook JSON.
 */
export interface Identification {
  result_version?: string;
  scoring_version?: string;
  /** Legacy 2026-10-06 only. */
  risk_events?: RiskEvent[];
  search_bot_owner?: string;
  ai_bot_owner?: string;
  ai_browser_owner?: string;
  hre?: HRE;
  fingerprint?: Fingerprint;
  /** UUID of the identification, created in the browser. */
  request_id: string;
  /** Server-side visitor identifier (sticky to the device). */
  visitor_id: string;
  /** Server-side device identifier. The all-zero UUID means no usable device signals. */
  device_id: string;
  /** One visit on one origin. */
  session_id: string;
  /** First-party browser identifier kept by the agent. */
  cookie_id: string;
  /** Your User HID as sent by the browser: "anonymous" for anonymous checks, null when it was empty. */
  user_hid: string | null;
  /** Registered domain of the site. */
  domain: string;
  public_ip: IpInfo;
  local_ip: IpInfo;
  connection_type: ConnectionType;
  os: string;
  browser: string;
  /** "desktop", "mobile", "tablet" or "unknown". */
  device_type: string;
  traffic_source: TrafficSource;
  /** Integer 0-100. A value above 100 (999) is a rate-limit marker, never a score. */
  risk_score: number;
  signals: IdentificationSignal[];
  detection_flags: DetectionFlags;
  /**
   * When the identification was observed, as an RFC 3339 UTC string with milliseconds
   * (for example "2026-09-30T12:34:56.123Z"). null only when the server sent a timestamp
   * that could not be parsed.
   */
  observed_at: string | null;
  /** Which payload this identification was built from. */
  source: 'webhook' | 'history';
  /** The original webhook `data` object or History row, including fields this model omits. */
  raw: Record<string, unknown>;
}

/** One page of History API results. */
export interface HistoryPage {
  /** Identifications, newest first. */
  data: Identification[];
  /** Total number of identifications that match the lookup. */
  total: number;
}

/** Domain profile from the Management API. */
export interface DomainProfile {
  /** The registered domain. */
  domain: string;
  /** Remaining included identifications. Negative when the account is over its included volume. */
  remaining_identifications: number;
  /** Public Key with every character except the last 4 replaced by "*". */
  public_key_masked: string;
  /** Secret Key with every character except the last 4 replaced by "*". */
  secret_key_masked: string;
  /** When the domain was created, as an RFC 3339 UTC string with milliseconds, or null. */
  created_at: string | null;
  /** The original response object. */
  raw: Record<string, unknown>;
}

// A declared (never emitted) string enum: unlike a plain string, its type does not overlap with
// the known event type literals, so a switch on event_type narrows them exactly.
declare enum UnknownEventTypeMarker {
  /** Placeholder member. Never compare against it. */
  Unknown = 'unknown',
}

/**
 * Type of `event_type` for an event this SDK version does not model. At runtime the value is the
 * plain string the server sent (for example "identification.refined"). This type only exists so
 * that `switch (event.event_type)` narrows the known event types exactly; it is assignable to
 * `string`, and `String(event.event_type)` compares it with other strings. A type only: there is
 * no runtime value to import.
 */
export type UnknownEventType = UnknownEventTypeMarker;

/** A verified `identification.scored` delivery. */
export interface IdentificationScoredEvent {
  event_id?: string;
  site_id?: number;
  event_type: 'identification.scored';
  schema_version: string;
  /** Envelope timestamp as sent (RFC 3339). */
  created_at: string;
  data: Identification;
  /** The parsed envelope as received. */
  raw: Record<string, unknown>;
}

/** A verified `webhook.ping` delivery (sent by Verify in the analytics dashboard). */
export interface WebhookPingEvent {
  event_id?: string;
  site_id?: number;
  event_type: 'webhook.ping';
  schema_version: string;
  created_at: string;
  raw: Record<string, unknown>;
}

/** A verified delivery with an event type this SDK version does not model. */
export interface UnknownWebhookEvent {
  event_id?: string;
  site_id?: number;
  event_type: UnknownEventType;
  schema_version: string;
  created_at: string;
  raw: Record<string, unknown>;
}

/** Every event `webhooks.constructEvent` can return. */
export type WebhookEvent = IdentificationScoredEvent | WebhookPingEvent | UnknownWebhookEvent;

/** Raw webhook body: the exact bytes received, or the same bytes decoded as UTF-8. */
export type WebhookPayload = string | Uint8Array | ArrayBuffer;

/** Value of the X-Shield-Signature header, as your framework exposes it. */
export type SignatureHeader = string | readonly string[] | null | undefined;

/** One endpoint signing secret, or several while you rotate secrets. */
export type WebhookSecret = string | readonly string[];

/** Minimal response shape the SDK needs from a fetch implementation. */
export interface FetchResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Request options the SDK passes to a fetch implementation. */
export interface FetchRequestInit {
  method: 'GET';
  headers: Record<string, string>;
  signal: AbortSignal;
}

/** A fetch-compatible function (the global `fetch` satisfies it). */
export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>;

/** Final scoring flags, including zero-weight events. Weights are not additive. */
export interface RiskEvent {
  code: string;
  detected: boolean;
  weight: number;
  contribution: number;
  status: string;
}
export interface HREResult {
  cluster_id?: string | null;
  status: string;
  level: string | null;
  reason: string;
  devices?: number;
  min_devices?: number;
}
export interface HRE {
  rules_version?: string;
  account_sharing: HREResult;
  account_takeover: HREResult;
  impossible_travel: HREResult;
}
export interface Fingerprint {
  outcome: string;
  record_id?: string;
  hardware_id?: string;
  rules_version: string;
  sharing?: Record<string, unknown>;
  takeover?: Record<string, unknown>;
  travel?: Record<string, unknown>;
}
