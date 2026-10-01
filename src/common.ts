// Exports shared by the Node entry (index.ts) and the edge entry (edge.ts).
export { ShieldLabs } from './history.js';
export type {
  GetIdentificationOptions,
  IterateOptions,
  SearchOptions,
  ShieldLabsOptions,
} from './history.js';
export { ShieldLabsManagement } from './management.js';
export type { GetProfileOptions, ShieldLabsManagementOptions } from './management.js';
export { evaluateIdentification, isRateLimited, riskBand } from './risk.js';
export type { EvaluateOptions, Evaluation, EvaluationReason } from './risk.js';
export { NIL_UUID, RISK_BANDS, SIGNALS } from './constants.js';
export type { KnownSignal } from './constants.js';
export { VERSION } from './version.js';
export {
  ApiError,
  AuthenticationError,
  BadRequestError,
  ConnectionError,
  NotFoundError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ShieldLabsError,
  SignatureVerificationError,
  TimeoutError,
  ValidationError,
  WebhookParseError,
} from './errors.js';
export type { ApiErrorOptions, HeadersLike } from './errors.js';
export type { Webhooks } from './webhooks.js';
export type {
  ConnectionType,
  DetectionFlags,
  DomainProfile,
  FetchLike,
  FetchRequestInit,
  FetchResponseLike,
  HistoryPage,
  Identification,
  IdentificationScoredEvent,
  IdentificationSignal,
  IpInfo,
  LookupType,
  RiskBand,
  SignatureHeader,
  TrafficSource,
  UnknownEventType,
  UnknownWebhookEvent,
  WebhookEvent,
  WebhookPayload,
  WebhookPingEvent,
  WebhookSecret,
} from './types.js';
