import type {
  HistoryPath,
  HistoryResponse,
  PingWebhook,
  ProfileResponse,
  ScoredData,
  ScoredWebhook,
} from './wire.js';

/** Identifier types the History API can search by. */
export type LookupType = HistoryPath['search_type'];

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
  | (ScoredData['connection_type'] & {});

type WireIpInfo = ScoredData['public_ip'];
type WireTrafficSource = ScoredData['traffic_source'];
type WireDetectionFlags = ScoredData['detection_flags'];

/** An IP address with its country. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Preserve the augmentable public interface.
export interface IpInfo extends WireIpInfo {}

/** Where the visit came from. Every value is a string, "" when absent. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Preserve the augmentable public interface.
export interface TrafficSource extends WireTrafficSource {}

type WireSignal = ScoredData['signals'][number];

/** One weighted risk signal behind the Risk Score. Display and log these; branch on detection_flags. */
export interface IdentificationSignal extends WireSignal {
  /** Server description of the signal (History API rows only; null for webhooks). */
  description: string | null;
}

/** The 19 stable detection flags. A flag the server did not send is false. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Preserve the augmentable public interface.
export interface DetectionFlags extends WireDetectionFlags {}

/**
 * One identification (one run of the ShieldLabs agent in one browser), normalized from a
 * webhook `data` object or a History API row. Property names follow the webhook JSON.
 */
export interface Identification extends Omit<
  ScoredData,
  | 'connection_type'
  | 'signals'
  | 'observed_at'
  | 'public_ip'
  | 'local_ip'
  | 'traffic_source'
  | 'detection_flags'
> {
  public_ip: IpInfo;
  local_ip: IpInfo;
  traffic_source: TrafficSource;
  detection_flags: DetectionFlags;
  connection_type: ConnectionType;
  signals: IdentificationSignal[];
  /**
   * When the identification was observed, as an RFC 3339 UTC string with milliseconds
   * (for example "2026-09-30T12:34:56.123Z"). null only when the server sent a timestamp
   * that could not be parsed.
   */
  observed_at: ScoredData['observed_at'] | null;
  /** Which payload this identification was built from. */
  source: 'webhook' | 'history';
  /** The original webhook `data` object or History row, including fields this model omits. */
  raw: Record<string, unknown>;
}

/** One page of History API results. */
export interface HistoryPage extends Omit<HistoryResponse, 'data'> {
  /** Identifications, newest first. */
  data: Identification[];
}

/** Domain profile from the Management API. */
export interface DomainProfile {
  /** The registered domain. */
  domain: ProfileResponse['Domain'];
  /** Remaining included identifications. Negative when the account is over its included volume. */
  remaining_identifications: ProfileResponse['Weight'];
  /** Public Key with every character except the last 4 replaced by "*". */
  public_key_masked: ProfileResponse['PublicKey'];
  /** Secret Key with every character except the last 4 replaced by "*". */
  secret_key_masked: ProfileResponse['Secret'];
  /** When the domain was created, as an RFC 3339 UTC string with milliseconds, or null. */
  created_at: ProfileResponse['CreatedAt'] | null;
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
export interface IdentificationScoredEvent extends Omit<ScoredWebhook, 'data'> {
  data: Identification;
  /** The parsed envelope as received. */
  raw: Record<string, unknown>;
}

/** A verified `webhook.ping` delivery (sent by Verify in the analytics dashboard). */
export interface WebhookPingEvent extends PingWebhook {
  raw: Record<string, unknown>;
}

/** A verified delivery with an event type this SDK version does not model. */
export interface UnknownWebhookEvent {
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
