import { KNOWN_SCHEMA_VERSION } from './constants.js';
import {
  ShieldLabsError,
  SignatureVerificationError,
  ValidationError,
  WebhookParseError,
} from './errors.js';
import { fromWebhookData, isPlainObject } from './normalize.js';
import { warnOnce } from './runtime.js';
import type {
  SignatureHeader,
  UnknownEventType,
  WebhookEvent,
  WebhookPayload,
  WebhookSecret,
} from './types.js';

/** Webhook signature verification and typed event parsing. */
export interface Webhooks {
  /**
   * True when `signatureHeader` (X-Shield-Signature) is a valid signature of `payload` for any
   * of the given secrets. Returns false for a malformed header, an empty secret or a payload that
   * is not raw bytes or a string. Needs node:crypto: in edge runtimes use `verifySignatureAsync`.
   */
  verifySignature(
    payload: WebhookPayload,
    signatureHeader: SignatureHeader,
    secret: WebhookSecret,
  ): boolean;
  /**
   * Verifies the signature, then parses the body into a typed event.
   * Throws SignatureVerificationError or WebhookParseError.
   * Needs node:crypto: in edge runtimes use `constructEventAsync`.
   */
  constructEvent(
    payload: WebhookPayload,
    signatureHeader: SignatureHeader,
    secret: WebhookSecret,
  ): WebhookEvent;
  /** Same as `verifySignature`, using WebCrypto where node:crypto is not available. */
  verifySignatureAsync(
    payload: WebhookPayload,
    signatureHeader: SignatureHeader,
    secret: WebhookSecret,
  ): Promise<boolean>;
  /** Same as `constructEvent`, using WebCrypto where node:crypto is not available. */
  constructEventAsync(
    payload: WebhookPayload,
    signatureHeader: SignatureHeader,
    secret: WebhookSecret,
  ): Promise<WebhookEvent>;
}

/** HMAC-SHA256 over `message` with the UTF-8 bytes of `key`. */
export type HmacSync = (key: string, message: Uint8Array) => Uint8Array;
export type HmacAsync = (key: string, message: Uint8Array) => Promise<Uint8Array>;

export interface CryptoBackend {
  /** Synchronous HMAC, or null where node:crypto is not loaded. */
  hmacSync: HmacSync | null;
  hmacAsync: HmacAsync;
  /** Constant-time comparison of two digests. */
  equal?: (a: Uint8Array, b: Uint8Array) => boolean;
}

const SIGNATURE_PREFIX = 'sha256=';
const HEX_DIGEST = /^[0-9a-fA-F]{64}$/;
const MISMATCH =
  'The webhook signature does not match the payload. Check the endpoint signing secret (including its whsec_ prefix) and verify the raw body bytes, not re-serialized JSON.';

const encoder = new TextEncoder();

/** Lowercase hex digest from an X-Shield-Signature header value, or null when malformed. */
export function parseSignatureHeader(header: unknown): string | null {
  let value = header;
  if (Array.isArray(value)) {
    if (value.length !== 1) return null;
    value = value[0];
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(SIGNATURE_PREFIX)) return null;
  const digest = trimmed.slice(SIGNATURE_PREFIX.length);
  return HEX_DIGEST.test(digest) ? digest.toLowerCase() : null;
}

/** The non-empty secrets of one secret or a list of secrets. */
export function secretList(secret: unknown): string[] {
  const list: unknown[] = Array.isArray(secret) ? secret : [secret];
  return list.filter((item): item is string => typeof item === 'string' && item !== '');
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]'
  );
}

/** The payload as bytes, or null when it is neither a string nor binary data. */
export function payloadBytes(payload: unknown): Uint8Array | null {
  if (typeof payload === 'string') return encoder.encode(payload);
  if (payload instanceof Uint8Array) return payload;
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (isArrayBuffer(payload)) return new Uint8Array(payload);
  return null;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Compares two byte arrays without an early exit. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

type Prepared =
  | { ok: true; bytes: Uint8Array; expected: Uint8Array; secrets: string[] }
  | { ok: false; reason: string };

function prepare(payload: unknown, header: unknown, secret: unknown): Prepared {
  const bytes = payloadBytes(payload);
  if (bytes === null) {
    return {
      ok: false,
      reason:
        'The payload must be the raw request body (a string, Uint8Array or ArrayBuffer). A parsed object cannot be verified because re-serializing changes the bytes.',
    };
  }
  const digest = parseSignatureHeader(header);
  if (digest === null) {
    return {
      ok: false,
      reason:
        'The X-Shield-Signature header is missing or malformed (expected sha256=<64 hex characters>).',
    };
  }
  const secrets = secretList(secret);
  if (secrets.length === 0) {
    return { ok: false, reason: 'No webhook signing secret was provided.' };
  }
  return { ok: true, bytes, expected: hexToBytes(digest), secrets };
}

const decoder = new TextDecoder('utf-8');

function preview(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

/** Parses verified webhook bytes into a typed event. */
export function parseEvent(bytes: Uint8Array): WebhookEvent {
  const text = decoder.decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new WebhookParseError('The webhook body is not valid JSON.', { cause: error });
  }
  if (!isPlainObject(parsed)) {
    throw new WebhookParseError('The webhook body is not a JSON object.');
  }
  const eventType = parsed.event_type;
  if (typeof eventType !== 'string' || eventType === '') {
    throw new WebhookParseError('The webhook body has no event_type.');
  }
  const schemaVersion = typeof parsed.schema_version === 'string' ? parsed.schema_version : '';
  const createdAt = typeof parsed.created_at === 'string' ? parsed.created_at : '';
  if (schemaVersion !== KNOWN_SCHEMA_VERSION) {
    warnOnce(
      `schema-version:${schemaVersion}`,
      `Received a webhook with schema_version "${preview(schemaVersion)}" while this SDK version targets "${KNOWN_SCHEMA_VERSION}". The event was parsed; update @shieldlabs-ai/node for typed support of newer fields.`,
    );
  }
  if (eventType === 'identification.scored') {
    if (!isPlainObject(parsed.data)) {
      throw new WebhookParseError('The identification.scored event has no data object.');
    }
    return {
      event_type: 'identification.scored',
      schema_version: schemaVersion,
      created_at: createdAt,
      data: fromWebhookData(parsed.data),
      raw: parsed,
    };
  }
  if (eventType === 'webhook.ping') {
    return {
      event_type: 'webhook.ping',
      schema_version: schemaVersion,
      created_at: createdAt,
      raw: parsed,
    };
  }
  return {
    event_type: eventType as UnknownEventType,
    schema_version: schemaVersion,
    created_at: createdAt,
    raw: parsed,
  };
}

export function syncUnavailable(fn: string, alternative: string): ShieldLabsError {
  return new ShieldLabsError(
    `${fn}() is synchronous and needs node:crypto, which the edge build of @shieldlabs-ai/node does not load. Use await ${alternative}() instead.`,
  );
}

/** Builds the `webhooks` helpers on top of a crypto backend. */
export function createWebhooks(backend: CryptoBackend): Webhooks {
  const equal = backend.equal ?? constantTimeEqual;

  function verifySync(
    payload: unknown,
    header: unknown,
    secret: unknown,
    hmac: HmacSync,
  ): Prepared {
    const prepared = prepare(payload, header, secret);
    if (!prepared.ok) return prepared;
    for (const key of prepared.secrets) {
      if (equal(hmac(key, prepared.bytes), prepared.expected)) return prepared;
    }
    return { ok: false, reason: MISMATCH };
  }

  async function verifyAsync(
    payload: unknown,
    header: unknown,
    secret: unknown,
  ): Promise<Prepared> {
    const prepared = prepare(payload, header, secret);
    if (!prepared.ok) return prepared;
    for (const key of prepared.secrets) {
      if (equal(await backend.hmacAsync(key, prepared.bytes), prepared.expected)) return prepared;
    }
    return { ok: false, reason: MISMATCH };
  }

  function requireSync(fn: string, alternative: string): HmacSync {
    if (backend.hmacSync === null) throw syncUnavailable(fn, alternative);
    return backend.hmacSync;
  }

  return Object.freeze({
    verifySignature(
      payload: WebhookPayload,
      signatureHeader: SignatureHeader,
      secret: WebhookSecret,
    ): boolean {
      const hmac = requireSync('webhooks.verifySignature', 'webhooks.verifySignatureAsync');
      return verifySync(payload, signatureHeader, secret, hmac).ok;
    },
    constructEvent(
      payload: WebhookPayload,
      signatureHeader: SignatureHeader,
      secret: WebhookSecret,
    ): WebhookEvent {
      const hmac = requireSync('webhooks.constructEvent', 'webhooks.constructEventAsync');
      const result = verifySync(payload, signatureHeader, secret, hmac);
      if (!result.ok) throw new SignatureVerificationError(result.reason);
      return parseEvent(result.bytes);
    },
    async verifySignatureAsync(
      payload: WebhookPayload,
      signatureHeader: SignatureHeader,
      secret: WebhookSecret,
    ): Promise<boolean> {
      return (await verifyAsync(payload, signatureHeader, secret)).ok;
    },
    async constructEventAsync(
      payload: WebhookPayload,
      signatureHeader: SignatureHeader,
      secret: WebhookSecret,
    ): Promise<WebhookEvent> {
      const result = await verifyAsync(payload, signatureHeader, secret);
      if (!result.ok) throw new SignatureVerificationError(result.reason);
      return parseEvent(result.bytes);
    },
  });
}

function validateUserHidInput(userId: unknown, secret: unknown): void {
  if (typeof userId !== 'string' || userId === '') {
    throw new ValidationError('userId must be a non-empty string.');
  }
  if (typeof secret !== 'string' || secret === '') {
    throw new ValidationError('secret must be a non-empty string.');
  }
}

/** HMAC-SHA256(key = secret, message = userId) as 64 lowercase hex characters. */
export function computeUserHid(backend: CryptoBackend, userId: string, secret: string): string {
  if (backend.hmacSync === null) throw syncUnavailable('userHid', 'userHidAsync');
  validateUserHidInput(userId, secret);
  return bytesToHex(backend.hmacSync(secret, encoder.encode(userId)));
}

export async function computeUserHidAsync(
  backend: CryptoBackend,
  userId: string,
  secret: string,
): Promise<string> {
  validateUserHidInput(userId, secret);
  return bytesToHex(await backend.hmacAsync(secret, encoder.encode(userId)));
}
