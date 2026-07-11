/** Webhook schema version currently emitted by Shield.Core. */
export const WEBHOOK_SCHEMA_VERSION = "2026-06-01" as const;

export type WebhookEventType = "identification.scored" | "webhook.ping";

export interface WebhookIPAddress {
  ip: string;
  country: string;
}

export interface WebhookSignal {
  name: string;
  weight: number;
}

export interface WebhookTrafficSource {
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

export interface WebhookDetectionFlags {
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
  stun_request_seen: boolean;
  stun_not_checked: boolean;
}

export interface WebhookScoredData {
  request_id: string;
  visitor_id: string;
  device_id: string;
  session_id: string;
  cookie_id: string;
  user_hid: string | null;
  domain: string;
  public_ip: WebhookIPAddress;
  local_ip: WebhookIPAddress;
  connection_type: string;
  os: string;
  browser: string;
  device_type: string;
  traffic_source: WebhookTrafficSource;
  risk_score: number;
  signals: WebhookSignal[];
  detection_flags: WebhookDetectionFlags;
  observed_at: string;
}

export interface WebhookEvent {
  event_type: WebhookEventType;
  schema_version: typeof WEBHOOK_SCHEMA_VERSION | string;
  created_at: string;
  data?: WebhookScoredData;
}
