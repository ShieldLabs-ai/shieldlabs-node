/** HTTP shapes generated from the checked-in OpenAPI description. Internal to the SDK. */
import type { components, operations } from './generated/api.js';

export type HistoryPath = operations['searchHistory']['parameters']['path'];
export type HistoryQuery = NonNullable<operations['searchHistory']['parameters']['query']>;
export type HistoryResponse =
  operations['searchHistory']['responses'][200]['content']['application/json'];
export type HistoryRow = HistoryResponse['data'][number];
export type ProfileHeaders = operations['getDomainProfile']['parameters']['header'];
export type ProfileResponse =
  operations['getDomainProfile']['responses'][200]['content']['application/json'];
export type ScoredWebhook =
  operations['identificationScored']['requestBody']['content']['application/json'];
export type PingWebhook = operations['webhookPing']['requestBody']['content']['application/json'];
export type ScoredData = ScoredWebhook['data'];
export type ScoreDetail = components['schemas']['ScoreDetail'];

/**
 * Declared fields of a wire object, optionally restricted to a value type. The History row's
 * index signature allows future fields in raw data; it must not hide a renamed column here.
 */
export type WireKeys<T, Value = unknown> = keyof {
  [K in keyof T as string extends K ? never : NonNullable<T[K]> extends Value ? K : never]: T[K];
} &
  string;
