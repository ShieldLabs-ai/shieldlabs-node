import { describe, expect, it } from 'vitest';
import { ApiError, ShieldLabs, VERSION } from '../src/index.js';
import type { Identification } from '../src/types.js';
import {
  REQUEST_ID,
  TEST_API_KEY,
  fakeFetch,
  historyPage,
  historyRow,
  jsonResponse,
  loadJson,
  rawResponse,
  settle,
  withoutRaw,
} from './helpers.js';

const normalization = loadJson<{
  cases: {
    name: string;
    source: string;
    input: Record<string, unknown>;
    expected: Omit<Identification, 'raw'>;
  }[];
}>('normalization-cases.json');
const historyExpected = normalization.cases.filter((c) => c.source === 'history');

function client(replies: Parameters<typeof fakeFetch>[0], baseUrl?: string) {
  const fake = fakeFetch(replies);
  const shieldlabs = new ShieldLabs({
    apiKey: TEST_API_KEY,
    baseUrl,
    fetch: fake.fetch,
    maxRetries: 0,
  });
  return { shieldlabs, fake };
}

describe('history.search requests', () => {
  it('sends a GET to the History API with credentials and SDK headers', async () => {
    const { shieldlabs, fake } = client([jsonResponse(loadJson('history-empty.json'))]);
    await shieldlabs.history.search('request_id', REQUEST_ID);
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call?.url).toBe(
      `https://account.shieldlabs.ai/api/v1/history/request_id/${REQUEST_ID}?limit=20&offset=0`,
    );
    expect(call?.init.method).toBe('GET');
    expect(call?.init.headers).toMatchObject({
      Authorization: `Bearer ${TEST_API_KEY}`,
      Accept: 'application/json',
    });
    expect(call?.init.headers['User-Agent']).toMatch(
      new RegExp(`^shieldlabs-node/${VERSION.replaceAll('.', '\\.')} node/\\d+`),
    );
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends UUIDs in lowercase and passes limit and offset', async () => {
    const { shieldlabs, fake } = client([historyPage([])]);
    await shieldlabs.history.search('device_id', 'D8E0F2A4-B6C8-4D0E-BF2A-4B6C8D0E2F4A', {
      limit: 5,
      offset: 40,
    });
    expect(fake.calls[0]?.url).toBe(
      'https://account.shieldlabs.ai/api/v1/history/device_id/d8e0f2a4-b6c8-4d0e-bf2a-4b6c8d0e2f4a?limit=5&offset=40',
    );
  });

  it.each([
    ['User@Example.com', 'User@Example.com'],
    ['a@b', 'a@b'],
    ['a+b', 'a+b'],
    ['a:b=c', 'a:b=c'],
    ['a,b', 'a,b'],
    ['a;b', 'a;b'],
    ['x$y&z', 'x$y&z'],
    ['a!b c', 'a%21b%20c'],
    ["it's (a)*", 'it%27s%20%28a%29%2A'],
    ['a b c?#%', 'a%20b%20c%3F%23%25'],
    ['Größe', 'Gr%C3%B6%C3%9Fe'],
    ['~u-1_v.2', '~u-1_v.2'],
    ['%2e', '%252e'],
    ['...', '...'],
    ['dGVzdA+=', 'dGVzdA+='],
  ])('sends the User HID %j in canonical path form', async (value, segment) => {
    const { shieldlabs, fake } = client([historyPage([])]);
    await shieldlabs.history.search('user_hid', value);
    const url = fake.calls[0]?.url ?? '';
    expect(url).toBe(
      `https://account.shieldlabs.ai/api/v1/history/user_hid/${segment}?limit=20&offset=0`,
    );
    expect(new URL(url).pathname).toBe(`/api/v1/history/user_hid/${segment}`);
    expect(decodeURIComponent(segment)).toBe(value);
  });

  it('keeps the canonical path form on the wire with the runtime fetch', async () => {
    const { createServer } = await import('node:http');
    const targets: string[] = [];
    const server = createServer((req, res) => {
      targets.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[],"total":0}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const shieldlabs = new ShieldLabs({
        apiKey: TEST_API_KEY,
        baseUrl: `http://127.0.0.1:${port}`,
        maxRetries: 0,
      });
      const values = ['a@b+c=', 'x$y&z,a;b:c', "a!b c'(d)*", 'Größe?#%', '~u-1_v.2'];
      for (const value of values) await shieldlabs.history.search('user_hid', value);
      expect(targets).toEqual([
        '/api/v1/history/user_hid/a@b+c=?limit=20&offset=0',
        '/api/v1/history/user_hid/x$y&z,a;b:c?limit=20&offset=0',
        '/api/v1/history/user_hid/a%21b%20c%27%28d%29%2A?limit=20&offset=0',
        '/api/v1/history/user_hid/Gr%C3%B6%C3%9Fe%3F%23%25?limit=20&offset=0',
        '/api/v1/history/user_hid/~u-1_v.2?limit=20&offset=0',
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('uses the same path form in history.iterate', async () => {
    const { shieldlabs, fake } = client([historyPage([])]);
    for await (const identification of shieldlabs.history.iterate('user_hid', 'a@b c')) {
      expect(identification).toBeUndefined();
    }
    expect(new URL(fake.calls[0]?.url ?? '').pathname).toBe('/api/v1/history/user_hid/a@b%20c');
  });

  it('sends IPv4 lookups unchanged', async () => {
    const { shieldlabs, fake } = client([historyPage([])]);
    await shieldlabs.history.search('ip', '203.0.113.24');
    expect(new URL(fake.calls[0]?.url ?? '').pathname).toBe('/api/v1/history/ip/203.0.113.24');
  });

  it.each([
    ['https://account.shieldlabs.ai/api', 'https://account.shieldlabs.ai/api/v1/history/'],
    ['https://account.shieldlabs.ai/api/', 'https://account.shieldlabs.ai/api/v1/history/'],
    ['https://account.shieldlabs.ai/API', 'https://account.shieldlabs.ai/api/v1/history/'],
    ['https://dev.account.shieldlabs.ai/', 'https://dev.account.shieldlabs.ai/api/v1/history/'],
    ['https://dev.account.shieldlabs.ai//', 'https://dev.account.shieldlabs.ai/api/v1/history/'],
    ['  https://account.shieldlabs.ai  ', 'https://account.shieldlabs.ai/api/v1/history/'],
    [
      'https://gateway.example.com/shieldlabs',
      'https://gateway.example.com/shieldlabs/api/v1/history/',
    ],
    [
      'https://gateway.example.com/shieldlabs/api/',
      'https://gateway.example.com/shieldlabs/api/v1/history/',
    ],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080/api/v1/history/'],
  ])('base URL %s never produces /api/api', async (baseUrl, prefix) => {
    const { shieldlabs, fake } = client([historyPage([])], baseUrl);
    await shieldlabs.history.search('request_id', REQUEST_ID);
    expect(fake.calls[0]?.url.startsWith(prefix)).toBe(true);
    expect(fake.calls[0]?.url).not.toContain('/api/api/');
  });
});

describe('history.search responses', () => {
  it('normalizes history-page.json exactly like normalization-cases.json', async () => {
    const pageBody = loadJson<{ data: Record<string, unknown>[]; total: number }>(
      'history-page.json',
    );
    const { shieldlabs } = client([jsonResponse(pageBody)]);
    const page = await shieldlabs.history.search('user_hid', 'anonymous');
    expect(page.total).toBe(37);
    expect(page.data).toHaveLength(5);
    page.data.forEach((identification, index) => {
      expect(withoutRaw(identification)).toStrictEqual(historyExpected[index]?.expected);
      expect(identification.source).toBe('history');
      expect(identification.raw).toStrictEqual(pageBody.data[index]);
      expect(identification.raw.ver).toBe(pageBody.data[index]?.ver);
    });
  });

  it('returns an empty page for history-empty.json', async () => {
    const { shieldlabs } = client([jsonResponse(loadJson('history-empty.json'))]);
    await expect(shieldlabs.history.search('request_id', REQUEST_ID)).resolves.toEqual({
      data: [],
      total: 0,
    });
  });

  it('parses the exact History body format (text with a trailing newline)', async () => {
    const body = `${JSON.stringify(loadJson('history-empty.json'))}\n`;
    const { shieldlabs } = client([rawResponse(body, 200, 'application/json')]);
    await expect(shieldlabs.history.search('request_id', REQUEST_ID)).resolves.toEqual({
      data: [],
      total: 0,
    });
  });

  it('skips rows that are not objects and falls back to the row count for a missing total', async () => {
    const { shieldlabs } = client([jsonResponse({ data: [historyRow(REQUEST_ID), 5, null, 'x'] })]);
    const page = await shieldlabs.history.search('request_id', REQUEST_ID);
    expect(page.data).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it.each([
    ['an array', jsonResponse([])],
    ['a null data field', jsonResponse({ data: null, total: 0 })],
    ['a missing data field', jsonResponse({ total: 3 })],
  ])('rejects %s with ApiError', async (_label, response) => {
    const { shieldlabs } = client([response]);
    const { error } = await settle(shieldlabs.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(200);
  });

  it('rejects a 200 response that is not JSON', async () => {
    const { shieldlabs } = client([rawResponse('<html>maintenance</html>', 200, 'text/html')]);
    const { error } = await settle(shieldlabs.history.search('request_id', REQUEST_ID));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toBe('<html>maintenance</html>');
    expect((error as ApiError).message).toMatch(/not valid JSON/);
  });

  it('can be used concurrently from one client', async () => {
    const { shieldlabs, fake } = client((call) => {
      const id = new URL(call.url).pathname.split('/').pop() ?? '';
      return historyPage([historyRow(id)]);
    });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const pages = await Promise.all(ids.map((id) => shieldlabs.history.search('request_id', id)));
    expect(pages.map((p) => p.data[0]?.request_id)).toEqual(ids);
    expect(fake.calls).toHaveLength(3);
  });
});

describe('history.iterate', () => {
  const ids = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

  function pagedServer(rowsByOffset: Record<number, string[]>, total: number) {
    return (call: { url: string }) => {
      const url = new URL(call.url);
      const offset = Number(url.searchParams.get('offset'));
      const rows = (rowsByOffset[offset] ?? []).map((id) => historyRow(id));
      return historyPage(rows, total);
    };
  }

  async function collect(iterable: AsyncIterable<Identification>): Promise<string[]> {
    const out: string[] = [];
    for await (const identification of iterable) out.push(identification.request_id);
    return out;
  }

  it('pages with offset and stops at total', async () => {
    const { shieldlabs, fake } = client(
      pagedServer(
        { 0: [ids[0]!, ids[1]!, ids[2]!], 3: [ids[3]!, ids[4]!, ids[5]!], 6: [ids[6]!] },
        7,
      ),
    );
    const result = await collect(shieldlabs.history.iterate('user_hid', 'u-1', { pageSize: 3 }));
    expect(result).toEqual(ids);
    expect(fake.calls.map((c) => new URL(c.url).search)).toEqual([
      '?limit=3&offset=0',
      '?limit=3&offset=3',
      '?limit=3&offset=6',
    ]);
  });

  it('skips rows repeated across pages when new rows shift the offsets', async () => {
    const { shieldlabs } = client(
      pagedServer({ 0: [ids[0]!, ids[1]!], 2: [ids[1]!, ids[2]!], 4: [ids[3]!] }, 5),
    );
    const result = await collect(shieldlabs.history.iterate('device_id', ids[6]!, { pageSize: 2 }));
    expect(result).toEqual([ids[0], ids[1], ids[2], ids[3]]);
  });

  it('stops at an empty page even when total promises more', async () => {
    const { shieldlabs, fake } = client(pagedServer({ 0: [ids[0]!, ids[1]!] }, 50));
    const result = await collect(shieldlabs.history.iterate('ip', '198.51.100.7', { pageSize: 2 }));
    expect(result).toEqual([ids[0], ids[1]]);
    expect(fake.calls).toHaveLength(2);
  });

  it('stops after maxItems without fetching more pages', async () => {
    const { shieldlabs, fake } = client(
      pagedServer({ 0: [ids[0]!, ids[1]!, ids[2]!], 3: [ids[3]!, ids[4]!, ids[5]!] }, 7),
    );
    const result = await collect(
      shieldlabs.history.iterate('visitor_id', ids[6]!, { pageSize: 3, maxItems: 4 }),
    );
    expect(result).toEqual([ids[0], ids[1], ids[2], ids[3]]);
    expect(fake.calls).toHaveLength(2);
  });

  it('stops exactly at a page boundary with maxItems', async () => {
    const { shieldlabs, fake } = client(pagedServer({ 0: [ids[0]!, ids[1]!] }, 7));
    const result = await collect(
      shieldlabs.history.iterate('session_id', ids[6]!, { pageSize: 2, maxItems: 2 }),
    );
    expect(result).toEqual([ids[0], ids[1]]);
    expect(fake.calls).toHaveLength(1);
  });

  it('sends nothing for maxItems 0', async () => {
    const { shieldlabs, fake } = client(pagedServer({ 0: [ids[0]!] }, 1));
    expect(
      await collect(shieldlabs.history.iterate('cookie_id', ids[6]!, { maxItems: 0 })),
    ).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it('uses 100 rows per page by default', async () => {
    const { shieldlabs, fake } = client(pagedServer({ 0: [ids[0]!] }, 1));
    await collect(shieldlabs.history.iterate('user_hid', 'u-1'));
    expect(new URL(fake.calls[0]?.url ?? '').searchParams.get('limit')).toBe('100');
  });

  it('yields rows without a request ID instead of dropping them', async () => {
    const { shieldlabs } = client([historyPage([historyRow(''), historyRow('')], 2)]);
    const result = await collect(shieldlabs.history.iterate('user_hid', 'u-1'));
    expect(result).toEqual(['', '']);
  });

  it('stops when the signal aborts between pages', async () => {
    const controller = new AbortController();
    const { shieldlabs, fake } = client(pagedServer({ 0: [ids[0]!], 1: [ids[1]!] }, 5));
    const seen: string[] = [];
    const run = (async () => {
      for await (const identification of shieldlabs.history.iterate('user_hid', 'u-1', {
        pageSize: 1,
        signal: controller.signal,
      })) {
        seen.push(identification.request_id);
        controller.abort(new Error('stopped by caller'));
      }
    })();
    await expect(run).rejects.toThrow('stopped by caller');
    expect(seen).toEqual([ids[0]]);
    expect(fake.calls).toHaveLength(1);
  });
});
