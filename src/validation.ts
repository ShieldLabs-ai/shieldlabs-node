import { LOOKUP_TYPES } from './constants.js';
import { ValidationError } from './errors.js';
import type { LookupType } from './types.js';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);

export interface Lookup {
  type: LookupType;
  value: string;
  /** The value escaped as one URL path segment. */
  segment: string;
}

function describe(value: unknown): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

// Escapes that canonical path escaping leaves as plain characters: $ & + , : ; = @
const PLAIN_IN_PATH = /%(?:24|26|2B|2C|3A|3B|3D|40)/g;
// Characters encodeURIComponent leaves as they are but canonical path escaping escapes.
const ESCAPED_IN_PATH = /[!'()*]/g;

/**
 * Escapes a User HID as one URL path segment in canonical form: A-Z, a-z, 0-9, "-", ".", "_",
 * "~" and $ & + , : ; = @ stay as they are, every other character becomes uppercase %XX of its
 * UTF-8 bytes. The History API decodes the value only when the path is escaped exactly this way
 * and otherwise compares the escaped text, which finds nothing.
 */
export function encodePathSegment(value: string): string {
  let escaped: string;
  try {
    escaped = encodeURIComponent(value);
  } catch {
    throw new ValidationError(
      'user_hid must be valid Unicode text (it has an unpaired surrogate).',
    );
  }
  return escaped
    .replace(PLAIN_IN_PATH, (match) => decodeURIComponent(match))
    .replace(ESCAPED_IN_PATH, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Validates a History lookup before anything is sent. The server does not validate: an unknown
 * type returns unfiltered rows and a malformed UUID or IP returns a 500.
 */
export function validateLookup(type: unknown, value: unknown): Lookup {
  if (typeof type !== 'string' || !LOOKUP_TYPES.includes(type as LookupType)) {
    throw new ValidationError(
      `Unknown lookup type ${describe(type)}. Use one of: ${LOOKUP_TYPES.join(', ')}.`,
    );
  }
  const lookupType = type as LookupType;
  if (typeof value !== 'string') {
    throw new ValidationError(`The ${lookupType} value must be a string.`);
  }
  if (lookupType === 'user_hid') {
    if (value === '') throw new ValidationError('user_hid must be a non-empty string.');
    if (value === '.' || value === '..') {
      throw new ValidationError(
        'user_hid cannot be "." or "..": a URL path segment cannot carry it.',
      );
    }
    if (value.includes('/')) {
      throw new ValidationError(
        'user_hid cannot contain "/": the History API cannot search a value with a slash. Use URL-safe User HIDs, such as the 64 hex characters of userHid().',
      );
    }
    return { type: lookupType, value, segment: encodePathSegment(value) };
  }
  if (lookupType === 'ip') {
    if (value.includes(':')) {
      throw new ValidationError(
        'IPv6 addresses cannot be searched: the History API stores IPv4 addresses only.',
      );
    }
    if (!IPV4.test(value)) {
      throw new ValidationError('ip must be a dotted IPv4 address such as 203.0.113.24.');
    }
    return { type: lookupType, value, segment: value };
  }
  if (!UUID.test(value)) {
    throw new ValidationError(`${lookupType} must be a UUID (8-4-4-4-12 hexadecimal digits).`);
  }
  const uuid = value.toLowerCase();
  return { type: lookupType, value: uuid, segment: uuid };
}

/** A request ID must be a UUID; it is sent lowercase. */
export function validateRequestId(requestId: unknown): string {
  if (typeof requestId !== 'string' || !UUID.test(requestId)) {
    throw new ValidationError('requestId must be a UUID (8-4-4-4-12 hexadecimal digits).');
  }
  return requestId.toLowerCase();
}

/** A boolean option. */
export function validateBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`${name} must be a boolean.`);
  return value;
}

/** Integer page size from 1 to 100 (the server silently turns other values into 20). */
export function validatePageSize(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new ValidationError(`${name} must be an integer from 1 to 100.`);
  }
  return value;
}

/** Integer greater than or equal to 0. */
export function validateNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${name} must be an integer greater than or equal to 0.`);
  }
  return value;
}

/** Finite number of milliseconds, greater than 0 (or greater than or equal to 0 when allowZero). */
export function validateMilliseconds(value: unknown, name: string, allowZero = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    const bound = allowZero ? 'greater than or equal to 0' : 'greater than 0';
    throw new ValidationError(`${name} must be a number of milliseconds ${bound}.`);
  }
  return value;
}

const HEADER_SAFE = /^[\x21-\x7E]+$/;

/**
 * Throws when `text` cannot be sent as an HTTP header value. The check runs before any request,
 * because the errors of the HTTP layer can echo the rejected value; the message never includes it.
 */
export function requireHeaderSafe(text: string, name: string): void {
  if (!HEADER_SAFE.test(text)) {
    throw new ValidationError(
      `${name} contains characters that cannot be sent in an HTTP header (only visible ASCII characters are allowed).`,
    );
  }
}

/** True when every character is ASCII. */
export function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

/** A non-empty string of visible ASCII characters (after trimming), returned trimmed. */
export function validateCredential(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${name} is required and must be a non-empty string.`);
  }
  const credential = value.trim();
  requireHeaderSafe(credential, name);
  return credential;
}
