import { describe, expect, it } from 'vitest';
import { ShieldLabs, ValidationError } from '../src/index.js';
import { REQUEST_ID, TEST_API_KEY, fakeFetch, historyPage } from './helpers.js';

const DOMAIN = '11111111-1111-4111-8111-111111111111';

function client(baseUrl?: string) {
  const fake = fakeFetch([historyPage([])]);
  const shieldlabs = new ShieldLabs({
    apiKey: TEST_API_KEY,
    baseUrl,
    fetch: fake.fetch,
    maxRetries: 0,
  });
  return { shieldlabs, fake };
}

describe('retired unscoped History search', () => {
  it('does not request /api/v1/history/{type}/{value}', async () => {
    const { shieldlabs, fake } = client();
    await expect(shieldlabs.history.search('identification_id', REQUEST_ID)).rejects.toThrow(
      ValidationError,
    );
    expect(() => shieldlabs.history.iterate('user_hid', 'anonymous')).toThrow(ValidationError);
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    ['https://account.shieldlabs.ai/api', 'https://account.shieldlabs.ai/api/v1/domains/'],
    ['https://account.shieldlabs.ai/api/', 'https://account.shieldlabs.ai/api/v1/domains/'],
    ['https://dev.account.shieldlabs.ai/', 'https://dev.account.shieldlabs.ai/api/v1/domains/'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080/api/v1/domains/'],
  ])('base URL %s never produces /api/api', async (baseUrl, prefix) => {
    const { shieldlabs, fake } = client(baseUrl);
    await shieldlabs.entities.list(DOMAIN, 'identifications');
    expect(fake.calls[0]?.url.startsWith(prefix)).toBe(true);
    expect(fake.calls[0]?.url).not.toContain('/api/api/');
    expect(fake.calls[0]?.url).not.toContain('/api/v1/history/');
  });
});
