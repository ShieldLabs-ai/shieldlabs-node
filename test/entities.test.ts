import { describe, expect, it } from 'vitest';
import { ShieldLabs, parseHistoryEntity } from '../src/index.js';
const domain = '11111111-1111-4111-8111-111111111111',
  id = '33333333-3333-4333-8333-333333333333';
const card = {
  type: 'identification',
  id,
  domain_id: domain,
  domain: 'example.com',
  risk: { state: 'ok', band: 'suspicious', score: 30, as_of: '2026-10-28T15:00:00Z' },
  signals: { state: 'unavailable', items: [] },
};
function api(body: unknown) {
  const calls: string[] = [];
  const sdk = new ShieldLabs({
    apiKey: 'sec_12345678-12345678-12345678',
    maxRetries: 0,
    fetch: async (url) => {
      calls.push(String(url));
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
      };
    },
  });
  return { sdk, calls };
}
describe('domain-scoped entity History', () => {
  it('reads a card without legacy normalization', async () => {
    const { sdk, calls } = api({ data: card });
    expect(await sdk.entities.get(domain, 'identifications', id)).toEqual(card);
    expect(calls[0]).toBe(
      `https://account.shieldlabs.ai/api/v1/domains/${domain}/history/identifications/${id}`,
    );
  });
  it('preserves unavailable risk without fabricating zero', async () => {
    const missing = { ...card, risk: { state: 'unavailable', band: null, as_of: null } };
    const { sdk } = api({ data: missing });
    expect((await sdk.entities.get(domain, 'identifications', id)).risk).toEqual(missing.risk);
  });
  it('forwards opaque page tokens and half-open query bounds', async () => {
    const { sdk, calls } = api({ data: [card], next_page_token: 'opaque+/=' });
    const options = {
      limit: 1,
      page_token: 'token+/=',
      from: '2026-10-27T00:00:00Z',
      to: '2026-10-28T00:00:00Z',
      filter: { identification: { risk_bands: ['suspicious'] } },
    };
    const page = await sdk.entities.list(domain, 'identifications', options);
    expect(page.next_page_token).toBe('opaque+/=');
    const u = new URL(calls[0]!);
    expect(u.searchParams.get('page_token')).toBe('token+/=');
    expect(JSON.parse(u.searchParams.get('filter')!)).toEqual(options.filter);
    expect(u.pathname).not.toContain('/history/identification_id/');
  });
  it('reads aggregate cards as aggregates', async () => {
    const aggregate = { ...card, type: 'user', id: 'a+b c%', identifications: 5 };
    const { sdk, calls } = api({ data: aggregate });
    expect((await sdk.entities.get(domain, 'user', 'a+b c%')).identifications).toBe(5);
    expect(calls[0]).toContain('/user/a%2Bb%20c%25');
  });
  it.each(['example.com', 'all', 'bad'])('refuses invalid domain %s without IO', async (d) => {
    const { sdk, calls } = api({ data: card });
    await expect(sdk.entities.get(d, 'identifications', id)).rejects.toThrow('UUID');
    expect(calls).toHaveLength(0);
  });
  it('rejects a wrong response domain/id/type', async () => {
    for (const replacement of [
      { domain_id: '22222222-2222-4222-8222-222222222222' },
      { id: '44444444-4444-4444-8444-444444444444' },
      { type: 'user' },
    ]) {
      const { sdk } = api({ data: { ...card, ...replacement } });
      await expect(sdk.entities.get(domain, 'identifications', id)).rejects.toThrow();
    }
  });
  it('rejects missing scores and invalid states', () => {
    expect(() =>
      parseHistoryEntity({ ...card, risk: { ...card.risk, score: undefined } }),
    ).toThrow();
    expect(() =>
      parseHistoryEntity({
        ...card,
        risk: { state: 'unavailable', band: null, as_of: null, score: 0 },
      }),
    ).toThrow();
  });
  it('rejects incomplete windows and unknown resources without IO', async () => {
    const { sdk, calls } = api({ data: [card], next_page_token: null });
    await expect(
      sdk.entities.list(domain, 'identifications', { from: '2026-10-28T00:00:00Z' }),
    ).rejects.toThrow();
    await expect(sdk.entities.list(domain, 'visitor' as 'identifications')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('preserves backend 410 and does not retry it', async () => {
    let calls = 0;
    const sdk = new ShieldLabs({
      apiKey: 'sec_12345678-12345678-12345678',
      fetch: async () => {
        calls++;
        return {
          status: 410,
          ok: false,
          headers: { get: () => null },
          text: async () => JSON.stringify({ error: { code: 'endpoint_retired' } }),
        };
      },
    });
    await expect(sdk.entities.list(domain, 'identifications')).rejects.toMatchObject({
      status: 410,
    });
    expect(calls).toBe(1);
  });
});

it('canonicalizes mapped IPv4 and rejects pure IPv6 or obsolete options without IO', async () => {
  const { sdk, calls } = api({ data: { ...card, type: 'ip', id: '203.0.113.1' } });
  await sdk.entities.get(domain, 'ip', '::ffff:203.0.113.1');
  expect(calls[0]).toContain('/ip/203.0.113.1');
  const n = calls.length;
  await expect(sdk.entities.get(domain, 'ip', '2001:db8::1')).rejects.toThrow();
  await expect(
    sdk.entities.list(domain, 'identifications', { offset: 5 } as never),
  ).rejects.toThrow();
  expect(calls).toHaveLength(n);
});

it('keeps explicit null objects and null aggregate counts from actual detail JSON', () => {
  const result = parseHistoryEntity({
    ...card,
    traffic: null,
    identity_risk: null,
    high_risk_events: null,
    device_identity: null,
  });
  expect(result.high_risk_events).toBeNull();
  expect(result.identity_risk).toBeNull();
  expect(
    parseHistoryEntity({
      ...card,
      type: 'user',
      id: 'qa',
      identifications: null,
      related_counts: null,
    }).identifications,
  ).toBeNull();
});
