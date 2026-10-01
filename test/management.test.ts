import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthenticationError,
  QuotaExceededError,
  RateLimitError,
  ShieldLabsManagement,
  VERSION,
} from '../src/index.js';
import { normalizeDomain } from '../src/management.js';
import { fakeFetch, jsonResponse, loadJson, rawResponse, settle } from './helpers.js';

const SECRET = '0123456789abcdef0123456789abcdef';

function client(
  replies: Parameters<typeof fakeFetch>[0],
  domain = 'example.com',
  baseUrl?: string,
) {
  const fake = fakeFetch(replies);
  const management = new ShieldLabsManagement({
    secretKey: SECRET,
    domain,
    baseUrl,
    fetch: fake.fetch,
    maxRetries: 0,
  });
  return { management, fake };
}

describe('getProfile', () => {
  it('returns the normalized DomainProfile from management-profile.json', async () => {
    const body = loadJson<Record<string, unknown>>('management-profile.json');
    const expected = loadJson<Record<string, unknown>>('management-profile-expected.json');
    const { management } = client([jsonResponse(body)]);
    const { raw, ...profile } = await management.getProfile();
    expect(profile).toStrictEqual(expected);
    expect(raw).toStrictEqual(body);
    expect(raw.Callback).toBe('');
  });

  it('sends GET /v1/profile with the domain header, the Secret Key and SDK headers', async () => {
    const { management, fake } = client(
      [jsonResponse(loadJson('management-profile.json'))],
      'https://www.Example.com/',
    );
    await management.getProfile();
    const [call] = fake.calls;
    expect(call?.url).toBe('https://api.shieldlabs.ai/v1/profile');
    expect(call?.init.method).toBe('GET');
    expect(call?.init.headers).toMatchObject({
      'X-Shield-Domain': 'example.com',
      Authorization: `Bearer ${SECRET}`,
      Accept: 'application/json',
    });
    expect(call?.init.headers['User-Agent']).toMatch(
      new RegExp(`^shieldlabs-node/${VERSION.replaceAll('.', '\\.')} `),
    );
  });

  it('exposes the normalized domain', () => {
    const { management } = client([], ' SHOP.Example.com ');
    expect(management.domain).toBe('shop.example.com');
  });

  it.each([
    ['https://dev.api.shieldlabs.ai/', 'https://dev.api.shieldlabs.ai/v1/profile'],
    ['https://gateway.example.com/management', 'https://gateway.example.com/management/v1/profile'],
    ['https://gateway.example.com/api', 'https://gateway.example.com/api/v1/profile'],
  ])('uses base URL %s', async (baseUrl, expected) => {
    const { management, fake } = client(
      [jsonResponse(loadJson('management-profile.json'))],
      'example.com',
      baseUrl,
    );
    await management.getProfile();
    expect(fake.calls[0]?.url).toBe(expected);
  });

  it('maps 401 to AuthenticationError', async () => {
    const { management } = client([rawResponse('', 401, null)]);
    const { error } = await settle(management.getProfile());
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).body).toBeNull();
  });

  it('maps 402 to QuotaExceededError', async () => {
    const { management } = client([rawResponse('', 402, null)]);
    await expect(management.getProfile()).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('raises a 429 without retrying', async () => {
    const fake = fakeFetch([
      rawResponse('{"error":"too many requests"}', 429, 'application/json; charset=utf-8'),
    ]);
    const management = new ShieldLabsManagement({
      secretKey: SECRET,
      domain: 'example.com',
      fetch: fake.fetch,
    });
    await expect(management.getProfile()).rejects.toBeInstanceOf(RateLimitError);
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects a body that is not an object', async () => {
    const { management } = client([jsonResponse([1, 2])]);
    const { error } = await settle(management.getProfile());
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(200);
  });

  it('supports cancellation', async () => {
    const { management, fake } = client([jsonResponse(loadJson('management-profile.json'))]);
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(management.getProfile({ signal: controller.signal })).rejects.toThrow('cancelled');
    expect(fake.calls).toHaveLength(0);
  });
});

describe('normalizeDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['https://example.com', 'example.com'],
    ['http://example.com/', 'example.com'],
    ['https://www.example.com/', 'example.com'],
    ['WWW.Example.com', 'example.com'],
    ['www.www.example.com', 'www.example.com'],
    ['https://shop.example.com/path/page?q=1#top', 'shop.example.com'],
    ['example.com/', 'example.com'],
    ['example.com?x', 'example.com'],
    ['example.com:8080', 'example.com:8080'],
    ['wss://example.com', 'example.com'],
    ['wwwexample.com', 'wwwexample.com'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});
