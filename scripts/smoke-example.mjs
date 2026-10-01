// End-to-end check of examples/node-http/server.mjs against a local stand-in for the History API.
// Needs a build first (npm run build). Uses only Node.js built-ins.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const API_KEY = 'sec_abcd1234-efgh5678-ijkl9012';
const WEBHOOK_SECRET = 'whsec_00112233445566778899aabbccddeeff';
// The example accepts comma-separated secrets while a secret is rotated.
const PREVIOUS_SECRET = 'whsec_ffeeddccbbaa99887766554433221100';
const LISTENING = /Listening on http:\/\/localhost:(\d+)/;
const HISTORY_PATH = /^\/api\/v1\/history\/request_id\/([0-9a-f-]+)$/;
const ids = {
  clean: '11111111-1111-4111-8111-111111111111',
  dangerous: '22222222-2222-4222-8222-222222222222',
  automation: '33333333-3333-4333-8333-333333333333',
  marker: '44444444-4444-4444-8444-444444444444',
  missing: '55555555-5555-4555-8555-555555555555',
};

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePage = JSON.parse(
  readFileSync(new URL('../test/data/history-page.json', import.meta.url), 'utf8'),
);
const baseRow = fixturePage.data[1];

function row(requestId, changes) {
  const createdAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  return { ...baseRow, request_id: requestId, created_at: createdAt, ...changes };
}

const rows = {
  [ids.clean]: row(ids.clean, {}),
  [ids.dangerous]: row(ids.dangerous, { score: 80 }),
  [ids.automation]: row(ids.automation, { score: 60, is_browser_automation: true }),
  [ids.marker]: row(ids.marker, { score: 999, device_id: '00000000-0000-0000-0000-000000000000' }),
};

const historyApi = createServer((req, res) => {
  const match = new URL(req.url, 'http://localhost').pathname.match(HISTORY_PATH);
  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('{"error":"invalid api key"}\n');
    return;
  }
  if (!match) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 page not found');
    return;
  }
  const found = rows[match[1]];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify({ data: found ? [found] : [], total: found ? 1 : 0 })}\n`);
});
historyApi.listen(0, '127.0.0.1');
await once(historyApi, 'listening');

const child = spawn(process.execPath, ['examples/node-http/server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    SHIELDLABS_API_KEY: API_KEY,
    SHIELDLABS_WEBHOOK_SECRET: ` ${WEBHOOK_SECRET} , ${PREVIOUS_SECRET}`,
    SHIELDLABS_API_BASE_URL: `http://127.0.0.1:${historyApi.address().port}`,
    PORT: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

const failures = [];
function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
  if (!condition) failures.push(label);
}

try {
  const started = Date.now();
  while (!LISTENING.test(output)) {
    if (child.exitCode !== null || Date.now() - started > 10_000) {
      throw new Error(`The example did not start:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const port = output.match(LISTENING)[1];
  const base = `http://127.0.0.1:${port}`;

  async function signup(body) {
    const res = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  async function deliver(body, secret = WEBHOOK_SECRET) {
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const res = await fetch(`${base}/webhooks/shieldlabs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shield-signature': signature },
      body,
    });
    return res.status;
  }

  // The missing case waits for the whole polling window (about 10 seconds), so run it alongside.
  const missing = signup({ requestId: ids.missing });

  const clean = await signup({ requestId: ids.clean });
  check(
    'a clean identification is accepted',
    clean.status === 201 && clean.body.band === 'trusted',
  );
  const replay = await signup({ requestId: ids.clean });
  check(
    'a reused request ID is refused',
    replay.status === 403 && replay.body.reason === 'replayed',
  );
  const dangerous = await signup({ requestId: ids.dangerous });
  check(
    'the dangerous band is refused',
    dangerous.status === 403 && dangerous.body.reason === 'blocked_band',
  );
  const automation = await signup({ requestId: ids.automation });
  check(
    'browser automation is refused',
    automation.status === 403 && automation.body.reason === 'blocked_flag',
  );
  const marker = await signup({ requestId: ids.marker });
  check(
    'the rate-limit marker is refused',
    marker.status === 403 && marker.body.reason === 'rate_limited',
  );
  const invalid = await signup({ requestId: 'not-a-uuid' });
  check('an invalid request ID is a 400', invalid.status === 400);
  const absent = await signup({});
  check('an absent request ID is a 400', absent.status === 400);

  const scored = readFileSync(
    new URL('../test/data/webhook-identification-scored.raw.txt', import.meta.url),
  );
  check('a signed delivery is accepted', (await deliver(scored)) === 200);
  check('a repeated delivery is accepted', (await deliver(scored)) === 200);
  check('a wrong signature is refused', (await deliver(scored, 'whsec_wrong')) === 401);
  const ping = readFileSync(new URL('../test/data/webhook-ping.raw.txt', import.meta.url));
  check('the ping is accepted', (await deliver(ping)) === 200);
  check(
    'a delivery signed with the previous secret is accepted during rotation',
    (await deliver(ping, PREVIOUS_SECRET)) === 200,
  );

  const missingResult = await missing;
  check(
    'a missing identification is refused',
    missingResult.status === 403 && missingResult.body.reason === 'missing',
  );

  await new Promise((resolve) => setTimeout(resolve, 100));
  const scoredLines = output.split('\n').filter((line) => line.startsWith('identification.scored'));
  check('each delivery is handled once', scoredLines.length === 1);
  check('the delivery log shows the band', scoredLines[0]?.includes('band=dangerous') === true);
  check(
    'the pings are logged',
    output.split('\n').filter((line) => line.startsWith('webhook.ping received')).length === 2,
  );
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  child.kill();
  historyApi.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed. Example output:\n${output}`);
  process.exit(1);
}
console.log('\nexamples/node-http works end to end.');
