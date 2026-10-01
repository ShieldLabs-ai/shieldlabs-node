// Runtime check of the built package on the oldest supported Node.js and in the edge build.
// Plain script (no test runner). Run after npm run build:
//   node test/runtime/smoke.mjs                        (Node entry)
//   node --conditions=worker test/runtime/smoke.mjs    (edge entry)
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AuthenticationError,
  RateLimitError,
  ShieldLabs,
  ShieldLabsManagement,
  SignatureVerificationError,
  evaluateIdentification,
  riskBand,
  userHid,
  userHidAsync,
  webhooks,
} from '@shieldlabs-ai/node';

const failures = [];
function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
  if (!condition) failures.push(label);
}

const data = (name) => readFileSync(new URL(`../data/${name}`, import.meta.url));
const page = JSON.parse(data('history-page.json').toString('utf8'));

let entry = 'node';
try {
  webhooks.verifySignature('x', `sha256=${'0'.repeat(64)}`, 'whsec_x');
} catch (error) {
  entry = /Async/.test(error.message) ? 'edge' : 'unknown';
}
const hasWebCrypto = Boolean(globalThis.crypto?.subtle);
console.log(
  `# ${entry} entry on Node.js ${process.versions.node} (WebCrypto ${hasWebCrypto ? 'available' : 'not global'})`,
);
check('a known entry was resolved', entry === 'node' || entry === 'edge');

function respond(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

// History API: search, polling and error mapping with a local fetch.
const row = {
  ...page.data[1],
  created_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
};
let polls = 0;
const history = new ShieldLabs({
  apiKey: 'sec_abcd1234-efgh5678-ijkl9012',
  fetch: async (url, init) => {
    if (init.headers.Authorization !== 'Bearer sec_abcd1234-efgh5678-ijkl9012')
      return respond(401, '{"error":"invalid api key"}\n');
    if (url.includes('/request_id/')) {
      polls += 1;
      return respond(200, { data: polls >= 3 ? [row] : [], total: polls >= 3 ? 1 : 0 });
    }
    if (url.includes('/ip/203.0.113.9'))
      return respond(429, '{"error":"too many requests"}\n', { 'retry-after': '1' });
    return respond(200, page);
  },
  maxRetries: 0,
});

const searched = await history.history.search('user_hid', 'anonymous');
check(
  'history.search normalizes the fixture page',
  searched.total === 37 && searched.data.length === 5,
);
check('History rows keep their raw fields', searched.data[0].raw.ver === page.data[0].ver);
const identification = await history.identifications.get(row.request_id, {
  pollInterval: 20,
  timeout: 2000,
});
check(
  'identifications.get polls until the row appears',
  identification?.request_id === row.request_id && polls === 3,
);
const verdict = evaluateIdentification(identification);
check(
  'evaluateIdentification accepts a fresh trusted identification',
  verdict.ok && verdict.band === 'trusted',
);
check('riskBand maps the marker', riskBand(999) === 'rate_limited');
try {
  await history.history.search('ip', '203.0.113.9');
  check('a 429 raises RateLimitError', false);
} catch (error) {
  check(
    'a 429 raises RateLimitError with retryAfter',
    error instanceof RateLimitError && error.retryAfter === 1,
  );
}
check(
  'a client constructs with the global fetch',
  new ShieldLabs({ apiKey: 'sec_zzzzzzzz-zzzzzzzz-zzzzzzzz' }) instanceof ShieldLabs,
);

// Management API.
const management = new ShieldLabsManagement({
  secretKey: '0123456789abcdef0123456789abcdef',
  domain: 'https://www.Example.com/',
  fetch: async (_url, init) =>
    init.headers['X-Shield-Domain'] === 'example.com'
      ? respond(200, data('management-profile.json').toString('utf8'))
      : respond(401, ''),
});
const profile = await management.getProfile();
check(
  'getProfile normalizes the profile',
  profile.remaining_identifications === 148230 && profile.created_at === '2026-01-15T09:00:00.000Z',
);
const unauthorized = new ShieldLabsManagement({
  secretKey: 'x',
  domain: 'example.com',
  fetch: async () => respond(401, ''),
});
try {
  await unauthorized.getProfile();
  check('a Management 401 raises AuthenticationError', false);
} catch (error) {
  check('a Management 401 raises AuthenticationError', error instanceof AuthenticationError);
}

// Webhooks.
const secret = 'whsec_00112233445566778899aabbccddeeff';
const ping = data('webhook-ping.raw.txt');
const pingHeader = 'sha256=ea2685733d254f7028fb031c4214583b0650de01e6c8c93131236024edd9fdd8';
const scored = data('webhook-identification-scored.raw.txt');
const scoredHeader = `sha256=${createHmac('sha256', secret).update(scored).digest('hex')}`;

if (entry === 'node') {
  check(
    'verifySignature accepts the ping',
    webhooks.verifySignature(ping, pingHeader, secret) === true,
  );
  check(
    'verifySignature refuses a wrong secret',
    webhooks.verifySignature(ping, pingHeader, 'whsec_other') === false,
  );
  const event = webhooks.constructEvent(scored, scoredHeader, secret);
  check(
    'constructEvent parses the scored delivery',
    event.event_type === 'identification.scored' && event.data.risk_score === 80,
  );
  check(
    'userHid computes HMAC-SHA256',
    userHid('user-42', secret) === createHmac('sha256', secret).update('user-42').digest('hex'),
  );
} else {
  let message = '';
  try {
    webhooks.constructEvent(scored, scoredHeader, secret);
  } catch (error) {
    message = error.message;
  }
  check(
    'the edge constructEvent points to constructEventAsync',
    message.includes('constructEventAsync'),
  );
}

if (entry === 'node' || hasWebCrypto) {
  check(
    'verifySignatureAsync accepts the ping',
    (await webhooks.verifySignatureAsync(ping, pingHeader, [secret])) === true,
  );
  const event = await webhooks.constructEventAsync(scored, scoredHeader, ['whsec_old', secret]);
  check(
    'constructEventAsync parses the scored delivery',
    event.event_type === 'identification.scored',
  );
  try {
    await webhooks.constructEventAsync(scored, pingHeader, secret);
    check('constructEventAsync refuses a bad signature', false);
  } catch (error) {
    check(
      'constructEventAsync refuses a bad signature',
      error instanceof SignatureVerificationError,
    );
  }
  check(
    'userHidAsync computes HMAC-SHA256',
    (await userHidAsync('user-42', secret)) ===
      createHmac('sha256', secret).update('user-42').digest('hex'),
  );
} else {
  console.log(
    '# skipped WebCrypto checks: globalThis.crypto is not available in this Node.js version',
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} runtime check(s) failed.`);
  process.exit(1);
}
console.log(`\nRuntime smoke test passed (${entry} entry).`);
