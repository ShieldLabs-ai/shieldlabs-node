/**
 * @shieldlabs/node — server-side SDK.
 *
 * Talks to the ShieldLabs API and verifies inbound webhooks. Your code
 * decides what to do with the score: you set the rules. This SDK never
 * makes the decision for you.
 */

export type { ShieldLabsClientOptions } from "./client.js";
export { ShieldLabsClient } from "./client.js";
export { verifyWebhook } from "./verifyWebhook.js";
export type {
  WebhookDetectionFlags,
  WebhookEvent,
  WebhookEventType,
  WebhookIPAddress,
  WebhookScoredData,
  WebhookSignal,
  WebhookTrafficSource,
} from "./types.js";
export { WEBHOOK_SCHEMA_VERSION } from "./types.js";
