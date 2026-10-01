import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ShieldLabs,
  ShieldLabsManagement,
  ValidationError,
  type LookupType,
} from '../src/index.js';
import { resetWarnings } from '../src/runtime.js';
import { encodePathSegment } from '../src/validation.js';
import { REQUEST_ID, TEST_API_KEY, fakeFetch, historyPage } from './helpers.js';

function client() {
  const fake = fakeFetch([historyPage([])]);
  return { shieldlabs: new ShieldLabs({ apiKey: TEST_API_KEY, fetch: fake.fetch }), fake };
}

afterEach(() => resetWarnings());

describe('History lookups are validated before any request', () => {
  const invalid: Array<[string, unknown, unknown]> = [
    ['unknown type', 'email', 'user@example.com'],
    ['empty type', '', REQUEST_ID],
    ['auto type', 'auto', REQUEST_ID],
    ['non-string type', 42, REQUEST_ID],
    ['uppercase type', 'REQUEST_ID', REQUEST_ID],
    ['bad UUID', 'device_id', 'not-a-uuid'],
    ['UUID with braces', 'visitor_id', `{${REQUEST_ID}}`],
    ['UUID without dashes', 'request_id', REQUEST_ID.replaceAll('-', '')],
    ['UUID with spaces', 'session_id', ` ${REQUEST_ID}`],
    ['URN UUID', 'cookie_id', `urn:uuid:${REQUEST_ID}`],
    ['IPv6', 'ip', '2001:db8::1'],
    ['IPv4-mapped IPv6', 'ip', '::ffff:192.0.2.1'],
    ['octet above 255', 'ip', '256.1.1.1'],
    ['three octets', 'ip', '192.0.2'],
    ['leading zero', 'ip', '192.0.02.1'],
    ['padded IP', 'ip', ' 192.0.2.1'],
    ['hostname', 'ip', 'example.com'],
    ['empty user_hid', 'user_hid', ''],
    ['dot user_hid', 'user_hid', '.'],
    ['dot-dot user_hid', 'user_hid', '..'],
    ['user_hid with a slash', 'user_hid', 'a/b'],
    ['base64 user_hid with a slash', 'user_hid', 'ab+/cd=='],
    ['user_hid with an unpaired surrogate', 'user_hid', 'a\uD800b'],
    ['non-string value', 'user_hid', 42],
    ['undefined value', 'device_id', undefined],
  ];

  it.each(invalid)('rejects %s', async (_label, type, value) => {
    const { shieldlabs, fake } = client();
    await expect(shieldlabs.history.search(type as LookupType, value as string)).rejects.toThrow(
      ValidationError,
    );
    expect(() => shieldlabs.history.iterate(type as LookupType, value as string)).toThrow(
      ValidationError,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it('explains why a User HID with a slash cannot be searched', async () => {
    const { shieldlabs } = client();
    await expect(shieldlabs.history.search('user_hid', 'a/b')).rejects.toThrow(
      /cannot contain "\/"/,
    );
  });

  it('explains that IPv6 cannot be searched', async () => {
    const { shieldlabs } = client();
    await expect(shieldlabs.history.search('ip', '2001:db8::7')).rejects.toThrow(/IPv6/);
  });

  it('lists the valid types for an unknown type', async () => {
    const { shieldlabs } = client();
    await expect(shieldlabs.history.search('email' as LookupType, 'x')).rejects.toThrow(
      /ip, user_hid, visitor_id, request_id, device_id, session_id, cookie_id/,
    );
  });

  it.each([0, 101, 1.5, -1, Number.NaN, '20'])('rejects limit %s', async (limit) => {
    const { shieldlabs, fake } = client();
    await expect(
      shieldlabs.history.search('request_id', REQUEST_ID, { limit: limit as number }),
    ).rejects.toThrow(ValidationError);
    expect(fake.calls).toHaveLength(0);
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, '0'])('rejects offset %s', async (offset) => {
    const { shieldlabs, fake } = client();
    await expect(
      shieldlabs.history.search('request_id', REQUEST_ID, { offset: offset as number }),
    ).rejects.toThrow(ValidationError);
    expect(fake.calls).toHaveLength(0);
  });

  it.each([0, 101, 2.5])('rejects pageSize %s', (pageSize) => {
    const { shieldlabs } = client();
    expect(() => shieldlabs.history.iterate('user_hid', 'u1', { pageSize })).toThrow(
      ValidationError,
    );
  });

  it.each([-1, 0.5])('rejects maxItems %s', (maxItems) => {
    const { shieldlabs } = client();
    expect(() => shieldlabs.history.iterate('user_hid', 'u1', { maxItems })).toThrow(
      ValidationError,
    );
  });

  it('accepts the boundary values', async () => {
    const { shieldlabs, fake } = client();
    await shieldlabs.history.search('request_id', REQUEST_ID, { limit: 1, offset: 0 });
    await shieldlabs.history.search('request_id', REQUEST_ID, { limit: 100, offset: 1_000_000 });
    await shieldlabs.history.search('ip', '0.0.0.0');
    await shieldlabs.history.search('ip', '255.255.255.255');
    await shieldlabs.history.search('device_id', '00000000-0000-0000-0000-000000000000');
    await shieldlabs.history.search('user_hid', 'anonymous');
    expect(fake.calls).toHaveLength(6);
  });
});

describe('User HID path segments', () => {
  it('escape every ASCII character in canonical path form', () => {
    const plain = /^[A-Za-z0-9\-._~$&+,:;=@]$/;
    for (let code = 0; code < 128; code++) {
      const char = String.fromCharCode(code);
      if (char === '/') continue;
      const expected = plain.test(char)
        ? char
        : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
      expect(encodePathSegment(`a${char}b`), JSON.stringify(char)).toBe(`a${expected}b`);
    }
  });

  it('escape other characters as uppercase UTF-8 bytes', () => {
    expect(encodePathSegment('ü')).toBe('%C3%BC');
    expect(encodePathSegment('日本')).toBe('%E6%97%A5%E6%9C%AC');
    expect(encodePathSegment('\u{1F600}')).toBe('%F0%9F%98%80');
  });

  it('match byte-wise canonical path escaping across Unicode', () => {
    // Canonical path escaping, one UTF-8 byte at a time.
    const plain = /^[A-Za-z0-9\-._~$&+,:;=@]$/;
    const canonical = (text: string): string =>
      Array.from(new TextEncoder().encode(text), (byte) => {
        const char = String.fromCharCode(byte);
        return plain.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }).join('');
    for (let code = 0x80; code <= 0x10ffff; code += 0x7f) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const text = `id ${String.fromCodePoint(code)}+=@%?#`;
      const segment = encodePathSegment(text);
      expect(segment, code.toString(16)).toBe(canonical(text));
      expect(decodeURIComponent(segment)).toBe(text);
    }
  });
});

describe('identifications.get validation', () => {
  it.each([['not-a-uuid'], [''], [42], [undefined]])('rejects request ID %s', async (requestId) => {
    const { shieldlabs, fake } = client();
    await expect(shieldlabs.identifications.get(requestId as string)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      shieldlabs.identifications.get(requestId as string, { wait: false }),
    ).rejects.toThrow(ValidationError);
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    [{ timeout: -1 }],
    [{ timeout: Number.NaN }],
    [{ pollInterval: 0 }],
    [{ pollInterval: -5 }],
    [{ pollInterval: Number.POSITIVE_INFINITY }],
    [{ wait: 'yes' }],
  ])('rejects options %j', async (options) => {
    const { shieldlabs, fake } = client();
    await expect(shieldlabs.identifications.get(REQUEST_ID, options as never)).rejects.toThrow(
      ValidationError,
    );
    expect(fake.calls).toHaveLength(0);
  });
});

describe('ShieldLabs constructor', () => {
  it.each([
    ['missing options', undefined],
    ['null options', null],
    ['empty apiKey', { apiKey: '' }],
    ['blank apiKey', { apiKey: '   ' }],
    ['non-string apiKey', { apiKey: 42 }],
    ['invalid URL', { apiKey: TEST_API_KEY, baseUrl: 'not a url' }],
    ['empty URL', { apiKey: TEST_API_KEY, baseUrl: '' }],
    ['ftp URL', { apiKey: TEST_API_KEY, baseUrl: 'ftp://account.shieldlabs.ai' }],
    [
      'URL with credentials',
      { apiKey: TEST_API_KEY, baseUrl: 'https://user:pass@account.shieldlabs.ai' },
    ],
    ['URL with query', { apiKey: TEST_API_KEY, baseUrl: 'https://account.shieldlabs.ai/?x=1' }],
    ['URL with fragment', { apiKey: TEST_API_KEY, baseUrl: 'https://account.shieldlabs.ai/#top' }],
    ['zero timeout', { apiKey: TEST_API_KEY, timeout: 0 }],
    ['negative timeout', { apiKey: TEST_API_KEY, timeout: -1 }],
    ['fractional retries', { apiKey: TEST_API_KEY, maxRetries: 1.5 }],
    ['negative retries', { apiKey: TEST_API_KEY, maxRetries: -1 }],
    ['fetch not a function', { apiKey: TEST_API_KEY, fetch: 'fetch' }],
  ])('rejects %s', (_label, options) => {
    expect(() => new ShieldLabs(options as never)).toThrow(ValidationError);
  });

  it.each([
    ['a line feed', `${TEST_API_KEY}\nX-Injected: 1`],
    ['a carriage return', `${TEST_API_KEY}\r\nX-Injected: 1`],
    ['a NUL character', `${TEST_API_KEY}\u0000`],
    ['an inner space', 'sec_abcd1234 efgh5678-ijkl9012'],
    ['a tab', 'sec_abcd1234\tefgh5678-ijkl9012'],
    ['a non-ASCII character', 'sec_abcd1234-efgh5678-ijkl901\u00fc'],
    ['a non-breaking space', 'sec_abcd1234\u00a0efgh5678-ijkl9012'],
  ])('rejects an apiKey with %s without echoing it', (_label, apiKey) => {
    const error = (() => {
      try {
        new ShieldLabs({ apiKey });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ValidationError);
    expect(error?.message).toMatch(
      /apiKey contains characters that cannot be sent in an HTTP header/,
    );
    expect(error?.message).not.toContain('abcd1234');
    expect(error?.cause).toBeUndefined();
  });

  it('warns once when the key does not look like a Private API Key, without printing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new ShieldLabs({ apiKey: 'pk_0123456789abcdef0123456789abcdef' });
    new ShieldLabs({ apiKey: 'pk_0123456789abcdef0123456789abcdef' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Private API Key/);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('0123456789abcdef');
  });

  it('does not warn for a well-formed key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new ShieldLabs({ apiKey: TEST_API_KEY });
    new ShieldLabs({ apiKey: `  ${TEST_API_KEY}  ` });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1:8080',
    'http://127.0.0.2',
    'http://127.1:9000',
    'http://localhost:8080',
    'http://api.localhost',
    'http://[::1]:8080',
    'http://[0:0:0:0:0:0:0:1]',
  ])('accepts plain http on the loopback host %s without a warning', (baseUrl) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(new ShieldLabs({ apiKey: TEST_API_KEY, baseUrl })).toBeInstanceOf(ShieldLabs);
    expect(
      new ShieldLabsManagement({ secretKey: 'secret', domain: 'example.com', baseUrl }),
    ).toBeInstanceOf(ShieldLabsManagement);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    'http://account.shieldlabs.ai',
    'http://history.example.com',
    'http://192.0.2.10:8080',
    'http://localhost.example.com',
    'http://[2001:db8::1]',
  ])('refuses plain http on %s', (baseUrl) => {
    expect(() => new ShieldLabs({ apiKey: TEST_API_KEY, baseUrl })).toThrow(
      /baseUrl must be an https URL.*allowInsecureHttp: true/,
    );
    expect(
      () => new ShieldLabsManagement({ secretKey: 'secret', domain: 'example.com', baseUrl }),
    ).toThrow(ValidationError);
  });

  it('accepts plain http on another host with allowInsecureHttp, with a one-time warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const baseUrl = 'http://mock.test:8080';
    new ShieldLabs({ apiKey: TEST_API_KEY, baseUrl, allowInsecureHttp: true });
    new ShieldLabs({ apiKey: TEST_API_KEY, baseUrl, allowInsecureHttp: true });
    new ShieldLabsManagement({
      secretKey: 'secret',
      domain: 'example.com',
      baseUrl: 'http://management.test',
      allowInsecureHttp: true,
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/plain http/);
  });

  it('rejects an allowInsecureHttp that is not a boolean', () => {
    expect(
      () => new ShieldLabs({ apiKey: TEST_API_KEY, allowInsecureHttp: 'yes' as never }),
    ).toThrow(/allowInsecureHttp must be a boolean/);
    expect(
      () =>
        new ShieldLabsManagement({
          secretKey: 'secret',
          domain: 'example.com',
          allowInsecureHttp: 1 as never,
        }),
    ).toThrow(ValidationError);
  });

  it('warns once when created in a web page, without printing the key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    new ShieldLabs({ apiKey: TEST_API_KEY });
    new ShieldLabs({ apiKey: TEST_API_KEY });
    new ShieldLabsManagement({ secretKey: 'my-secret-value', domain: 'example.com' });
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages[0]).toMatch(/ShieldLabs was created in a web page.*Private API Key/);
    expect(messages[1]).toMatch(/ShieldLabsManagement was created in a web page.*Secret Key/);
    expect(messages.join(' ')).not.toContain(TEST_API_KEY);
    expect(messages.join(' ')).not.toContain('my-secret-value');
  });

  it('does not warn in a worker, which has no document', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', {});
    new ShieldLabs({ apiKey: TEST_API_KEY });
    expect(warn).not.toHaveBeenCalled();
  });

  it('never exposes the key as a property', () => {
    const shieldlabs = new ShieldLabs({ apiKey: TEST_API_KEY });
    expect(JSON.stringify(shieldlabs)).not.toContain(TEST_API_KEY);
    expect(Object.keys(shieldlabs)).toEqual(['identifications', 'history']);
  });
});

describe('ShieldLabsManagement constructor', () => {
  it.each([
    ['missing options', undefined],
    ['empty secret', { secretKey: '', domain: 'example.com' }],
    ['missing domain', { secretKey: 'secret' }],
    ['non-string domain', { secretKey: 'secret', domain: 42 }],
    ['empty domain', { secretKey: 'secret', domain: '  ' }],
    ['scheme only', { secretKey: 'secret', domain: 'https://' }],
    ['bad base URL', { secretKey: 'secret', domain: 'example.com', baseUrl: 'api.shieldlabs.ai' }],
    ['zero timeout', { secretKey: 'secret', domain: 'example.com', timeout: 0 }],
    ['negative retries', { secretKey: 'secret', domain: 'example.com', maxRetries: -1 }],
    ['fetch not a function', { secretKey: 'secret', domain: 'example.com', fetch: {} }],
  ])('rejects %s', (_label, options) => {
    expect(() => new ShieldLabsManagement(options as never)).toThrow(ValidationError);
  });

  it.each([
    ['a line feed', '0123456789abcdef\r\n0123456789abcdef'],
    ['a NUL character', '0123456789abcdef\u00000123456789abcdef'],
    ['an inner space', '0123456789abcdef 0123456789abcdef'],
    ['a non-ASCII character', '0123456789abcdef\u00e90123456789abcdef'],
  ])('rejects a secretKey with %s without echoing it', (_label, secretKey) => {
    expect(() => new ShieldLabsManagement({ secretKey, domain: 'example.com' })).toThrow(
      /secretKey contains characters that cannot be sent in an HTTP header/,
    );
    try {
      new ShieldLabsManagement({ secretKey, domain: 'example.com' });
    } catch (error) {
      expect((error as Error).message).not.toContain('0123456789abcdef');
    }
  });

  it.each([
    ['a line feed', 'example.com\nX-Injected: 1'],
    ['a NUL character', 'example\u0000.com'],
    ['an inner space', 'exam ple.com'],
    ['a tab', 'example.com\tx'],
  ])('rejects a domain with %s', (_label, domain) => {
    expect(() => new ShieldLabsManagement({ secretKey: 'secret', domain })).toThrow(
      /domain contains characters that cannot be sent in an HTTP header/,
    );
  });

  it('asks for the punycode form of a non-ASCII domain', () => {
    expect(
      () =>
        new ShieldLabsManagement({ secretKey: 'secret', domain: 'https://www.M\u00fcnchen.de/' }),
    ).toThrow(/punycode/);
    expect(
      new ShieldLabsManagement({ secretKey: 'secret', domain: 'xn--mnchen-3ya.de' }).domain,
    ).toBe('xn--mnchen-3ya.de');
  });

  it('never exposes the secret as a property', () => {
    const management = new ShieldLabsManagement({
      secretKey: 'my-secret-value',
      domain: 'example.com',
    });
    expect(JSON.stringify(management)).not.toContain('my-secret-value');
  });
});
