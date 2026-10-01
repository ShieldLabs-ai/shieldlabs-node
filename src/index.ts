/**
 * @shieldlabs-ai/node for Node.js and Bun.
 *
 * Read identifications from the History API, read the domain profile from the Management API,
 * verify signed webhooks and apply risk helpers. Edge runtimes resolve `edge.ts` instead, which
 * exposes the same API without loading node:crypto.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  computeUserHid,
  computeUserHidAsync,
  createWebhooks,
  type CryptoBackend,
  type Webhooks,
} from './webhooks.js';

const hmacSync = (key: string, message: Uint8Array): Uint8Array =>
  createHmac('sha256', key).update(message).digest();

const backend: CryptoBackend = {
  hmacSync,
  hmacAsync: (key, message) => Promise.resolve().then(() => hmacSync(key, message)),
  equal: (a, b) => a.length === b.length && timingSafeEqual(a, b),
};

/** Webhook signature verification (X-Shield-Signature) and typed event parsing. */
export const webhooks: Webhooks = createWebhooks(backend);

/**
 * A stable, irreversible User HID for one of your accounts: HMAC-SHA256 of `userId` keyed with
 * `secret`, as 64 lowercase hex characters. Compute it on your server and pass it to the browser
 * agent instead of a raw email address or account ID. Throws ValidationError on empty input.
 * Needs node:crypto: in edge runtimes use `userHidAsync`.
 */
export function userHid(userId: string, secret: string): string {
  return computeUserHid(backend, userId, secret);
}

/** Same as `userHid`, as a promise (works in every runtime). */
export function userHidAsync(userId: string, secret: string): Promise<string> {
  return computeUserHidAsync(backend, userId, secret);
}

export * from './common.js';
