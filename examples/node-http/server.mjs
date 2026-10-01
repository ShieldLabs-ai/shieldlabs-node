// A minimal ShieldLabs integration on plain node:http, with no framework and no dependencies.
//
//   POST /signup               { "requestId": "<request ID from the browser>" }
//   POST /webhooks/shieldlabs  signed identification.scored and webhook.ping deliveries
//
// Environment:
//   SHIELDLABS_API_KEY         Private API Key (sec_...)
//   SHIELDLABS_WEBHOOK_SECRET  endpoint signing secret (whsec_...); while you rotate secrets,
//                              the new and the old secret separated by a comma
//   SHIELDLABS_API_BASE_URL    optional History API override (development and tests)
//   PORT                       optional, default 3000
import { createServer } from 'node:http';
import {
  ShieldLabs,
  SignatureVerificationError,
  ValidationError,
  WebhookParseError,
  evaluateIdentification,
  riskBand,
  webhooks,
} from '@shieldlabs-ai/node';

const apiKey = process.env.SHIELDLABS_API_KEY;
const webhookSecrets = (process.env.SHIELDLABS_WEBHOOK_SECRET ?? '')
  .split(',')
  .map((secret) => secret.trim())
  .filter((secret) => secret !== '');
if (!apiKey || webhookSecrets.length === 0) {
  console.error(
    'Set SHIELDLABS_API_KEY and SHIELDLABS_WEBHOOK_SECRET before starting the example.',
  );
  process.exit(1);
}

// One client for the whole process: it is safe for concurrent use.
const shieldlabs = new ShieldLabs({ apiKey, baseUrl: process.env.SHIELDLABS_API_BASE_URL });

// Request IDs that already authorized a signup. With more than one process, claim them in a
// shared store with an atomic insert-if-absent (Redis SET key 1 NX EX 600, or an insert into a
// table with a unique key) and an expiry a little longer than the freshness window.
const usedRequestIds = new Set();

// True for the first caller only. Nothing is awaited between the check and the add, so this is
// atomic within one process.
function claimRequestId(requestId) {
  if (usedRequestIds.has(requestId)) return false;
  usedRequestIds.add(requestId);
  return true;
}

// Deliveries already handled, by request ID. Today each identification is delivered once (one
// attempt, 1-second timeout, no retries); future retries resend identical bytes, so handlers
// must be idempotent on data.request_id.
const handledDeliveries = new Set();

const MAX_BODY_BYTES = 1_000_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleSignup(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch {
    return sendJson(res, 400, { error: 'Send a JSON body with requestId.' });
  }
  const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
  if (!requestId) return sendJson(res, 400, { error: 'requestId is required.' });

  let identification;
  try {
    // Scoring is asynchronous: this waits (with backoff) until the verdict is stored.
    identification = await shieldlabs.identifications.get(requestId);
  } catch (error) {
    if (error instanceof ValidationError)
      return sendJson(res, 400, { error: 'requestId must be a UUID.' });
    throw error;
  }

  // Claim the request ID first, then evaluate. Refuses a missing identification (unverified,
  // never clean), a reused request ID, an identification older than 5 minutes, the rate-limit
  // marker, missing device signals, browser automation or disabled JavaScript, and the
  // dangerous band. Tune the defaults.
  const firstUse = identification !== null && claimRequestId(identification.request_id);
  const verdict = evaluateIdentification(identification, { isReplay: () => !firstUse });
  if (!verdict.ok) {
    return sendJson(res, 403, { ok: false, reason: verdict.reason });
  }

  // Create the account here.
  return sendJson(res, 201, { ok: true, band: verdict.band });
}

async function handleWebhook(req, res) {
  // Verify the raw bytes before parsing anything.
  const rawBody = await readBody(req);
  let event;
  try {
    event = webhooks.constructEvent(rawBody, req.headers['x-shield-signature'], webhookSecrets);
  } catch (error) {
    if (error instanceof SignatureVerificationError)
      return sendJson(res, 401, { error: 'Invalid signature.' });
    if (error instanceof WebhookParseError)
      return sendJson(res, 400, { error: 'Invalid payload.' });
    throw error;
  }

  // Answer within one second, then do the work (or hand it to a queue).
  sendJson(res, 200, { received: true });

  switch (event.event_type) {
    case 'identification.scored': {
      const { data } = event;
      if (handledDeliveries.has(data.request_id)) return;
      handledDeliveries.add(data.request_id);
      console.log(
        `identification.scored ${data.request_id} risk_score=${data.risk_score} band=${riskBand(data.risk_score)}`,
      );
      break;
    }
    case 'webhook.ping':
      console.log('webhook.ping received: the endpoint is verified');
      break;
    default:
      console.log(`Ignoring event type ${String(event.event_type)}`);
  }
}

const routes = {
  'POST /signup': handleSignup,
  'POST /webhooks/shieldlabs': handleWebhook,
};

const server = createServer((req, res) => {
  const handler = routes[`${req.method} ${(req.url ?? '').split('?')[0]}`];
  if (!handler) return sendJson(res, 404, { error: 'Not found.' });
  handler(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.statusCode ?? 500, { error: 'Internal error.' });
  });
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Listening on http://localhost:${server.address().port}`);
});
