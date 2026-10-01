/**
 * @shieldlabs-ai/node for edge runtimes, workers, Deno and browsers.
 *
 * Same API as the Node entry, built on fetch and WebCrypto only. It never loads node:crypto, so
 * the synchronous helpers (`webhooks.verifySignature`, `webhooks.constructEvent`, `userHid`)
 * throw an error that points to their Async variants.
 */
import { ShieldLabsError } from './errors.js';
import {
  computeUserHid,
  computeUserHidAsync,
  createWebhooks,
  type CryptoBackend,
  type Webhooks,
} from './webhooks.js';

interface SubtleLike {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: 'HMAC'; hash: 'SHA-256' },
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  sign(algorithm: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

const encoder = new TextEncoder();

function subtle(): SubtleLike {
  const cryptoObject = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto;
  if (!cryptoObject?.subtle) {
    throw new ShieldLabsError('WebCrypto (crypto.subtle) is not available in this runtime.');
  }
  return cryptoObject.subtle;
}

async function hmacAsync(key: string, message: Uint8Array): Promise<Uint8Array> {
  const webCrypto = subtle();
  const cryptoKey = await webCrypto.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await webCrypto.sign('HMAC', cryptoKey, message));
}

const backend: CryptoBackend = { hmacSync: null, hmacAsync };

/** Webhook signature verification (X-Shield-Signature) and typed event parsing. */
export const webhooks: Webhooks = createWebhooks(backend);

/**
 * Not available in this build: it needs node:crypto. Throws an error that points to
 * `userHidAsync`, which computes the same value with WebCrypto.
 */
export function userHid(userId: string, secret: string): string {
  return computeUserHid(backend, userId, secret);
}

/**
 * A stable, irreversible User HID for one of your accounts: HMAC-SHA256 of `userId` keyed with
 * `secret`, as 64 lowercase hex characters. Throws ValidationError on empty input.
 */
export function userHidAsync(userId: string, secret: string): Promise<string> {
  return computeUserHidAsync(backend, userId, secret);
}

export * from './common.js';
