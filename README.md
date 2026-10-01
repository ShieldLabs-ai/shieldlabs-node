# @shieldlabs-ai/node

Read ShieldLabs identifications, verify signed webhooks and apply risk checks from your Node.js or edge backend.

[![CI](https://github.com/ShieldLabs-ai/shieldlabs-node/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldLabs-ai/shieldlabs-node/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@shieldlabs-ai/node.svg)](https://www.npmjs.com/package/@shieldlabs-ai/node)

## How it fits

1. **Browser.** The ShieldLabs agent runs an identification and hands your page a `requestId`.
   The browser never sees a Risk Score, a visitor ID or a device ID.
2. **Your backend.** It receives the `requestId` together with the protected action (signup,
   login, checkout) and reads the verdict with this SDK, or receives it in a signed
   `identification.scored` webhook.
3. **Decision.** Your backend acts on `risk_score`, the three risk bands, `detection_flags` and
   the identifiers (for example, how many accounts one `device_id` has created).

This package covers steps 2 and 3. For step 1, use the browser SDK (`@shieldlabs-ai/js` or a
framework package). New to ShieldLabs? Start free at [app.shieldlabs.ai](https://app.shieldlabs.ai).

## Install

```bash
npm install @shieldlabs-ai/node
```

Node.js 18 or later, with no runtime dependencies. The same package is designed for Bun, Deno and
edge runtimes with `fetch` and WebCrypto, such as Cloudflare Workers and Vercel Edge Functions
(see [Edge runtimes, Bun and Deno](#edge-runtimes-bun-and-deno)).

## Quick start

```ts
import { ShieldLabs, evaluateIdentification, webhooks } from '@shieldlabs-ai/node';

const shieldlabs = new ShieldLabs({ apiKey: process.env.SHIELDLABS_API_KEY! });

// One identification authorizes one action. This in-memory set keeps the example short; in
// production, claim request IDs atomically in Redis or your database (see "Apply a policy").
const usedRequestIds = new Set<string>();

function claimRequestId(requestId: string): boolean {
  if (usedRequestIds.has(requestId)) return false;
  usedRequestIds.add(requestId);
  return true;
}

// 1. Call this with the requestId the browser sent together with the signup form.
export async function allowSignup(requestId: string): Promise<boolean> {
  // Scoring is asynchronous: this waits (up to 10 s by default) until the verdict is stored.
  const identification = await shieldlabs.identifications.get(requestId);

  // 2. Missing, reused, stale, rate-limited, automated or dangerous: refuse.
  const firstUse = identification !== null && claimRequestId(identification.request_id);
  const verdict = evaluateIdentification(identification, { isReplay: () => !firstUse });
  return verdict.ok;
}

// 3. Call this with the raw body and the X-Shield-Signature header of a webhook delivery.
export function handleWebhook(rawBody: string | Uint8Array, signatureHeader: string | null): void {
  const event = webhooks.constructEvent(
    rawBody,
    signatureHeader,
    process.env.SHIELDLABS_WEBHOOK_SECRET!,
  );
  if (event.event_type === 'identification.scored') {
    console.log(event.data.request_id, event.data.risk_score, event.data.detection_flags.vpn);
  }
}
```

Environment variables used throughout: `SHIELDLABS_API_KEY` (Private API Key, `sec_...`),
`SHIELDLABS_WEBHOOK_SECRET` (endpoint signing secret, `whsec_...`), `SHIELDLABS_SECRET_KEY` and
`SHIELDLABS_DOMAIN` (Management API), and `SHIELDLABS_API_BASE_URL` /
`SHIELDLABS_MANAGEMENT_BASE_URL` to point at another host in development and tests (https, or
plain http on `localhost`). The SDK never reads the environment itself: pass the values to the
constructors. For development and staging, register a separate domain in the analytics dashboard
and use its keys.

A runnable version of this flow is in [`examples/node-http`](examples/node-http).

## Guide

### Wait for the verdict

The History row of an identification appears about 1 to 3 seconds after the browser call and can
be refined for up to about 10 seconds while follow-up checks finish (network checks such as the
local IP arrive in later versions of the row). Start the identification when the user begins the
action, for example when the signup form gets focus, so the verdict is usually stored by the time
the form is submitted. `identifications.get(requestId)` polls the History API until the row
appears and returns the first version it sees. How it waits:

- **Total budget.** `timeout` (default 10 000 ms) is the time budget of the whole call, counted
  from the call and including the time requests take.
- **Schedule.** The first poll runs at once. With `pollInterval` p (default 250 ms), the waits
  between polls are p, 2p, 4p, 6p and then 8p for every later wait, each capped at 2 s, or at p
  when p is longer: 250 ms, 500 ms, 1 s, 1.5 s and then every 2 s by default. A `pollInterval`
  of 1 000 waits 1 s and then every 2 s, and one of 3 000 polls every 3 s. A wait that would pass
  the deadline is cut short, so the last poll runs at the deadline.
- **One attempt per poll.** Each poll is a single HTTP attempt that is never retried
  (`maxRetries` does not apply). Its timeout is the client `timeout`, shortened to the time left
  but never below 1 s.
- **Transient errors keep polling.** A 429, a 5xx, a connection error or an attempt timeout does
  not end the wait.
- **429.** The next wait is the longest of the scheduled wait, 1 s (the History limit counts
  requests per second) and `Retry-After` capped at 10 s. A missing `Retry-After`, `0` or a date in
  the past counts as 0, so the 1 s floor still applies. That wait is cut short at the deadline like
  any other, and the last poll runs there. When the capped `Retry-After` is longer than the time
  left, that `RateLimitError` is thrown at once.
- **At the deadline.** If the last poll failed, its error is thrown. If it found nothing, the call
  resolves `null`.
- **Errors that do not heal.** 400, 401, 403 and 404 are thrown at once: a wrong key or base URL
  stays wrong.

```ts
const identification = await shieldlabs.identifications.get(requestId, {
  timeout: 5_000, // total budget: the last poll runs 5 s after the call
  pollInterval: 250, // waits of p, 2p, 4p, 6p, then 8p, each at most max(2 s, p)
  signal: AbortSignal.timeout(6_000), // hard limit, including the last request
});

if (identification === null) {
  // Unverified, never "clean": treat it like a failed check.
}

// Read once, without waiting:
const latest = await shieldlabs.identifications.get(requestId, { wait: false });
```

`null` means no row existed for the request ID when the last poll ran. It also covers an
identification that was never stored, for example when the visitor's IP went over the per-IP rate
limit of identifications: the browser still gets a request ID, but no row is written for it. With
`wait: false`, `identifications.get` reads once and uses the client's normal retries. To read the
refined row later, call `identifications.get(requestId, { wait: false })` again after about 10
seconds.

### Apply a policy

`evaluateIdentification` turns the guard logic every integration needs into one call. Checks run
in this order and the first failure wins:

| Order | Check | `reason` |
|---|---|---|
| 1 | No identification (`null`) | `missing` |
| 2 | `isReplay(requestId)` returned true | `replayed` |
| 3 | Older than `maxAge` (default 5 minutes, by `observed_at`; `Infinity` skips this check) | `stale` |
| 4 | Risk Score above 100 (the 999 rate-limit marker) | `rate_limited` |
| 5 | All-zero device ID (no usable device signals) | `no_device_signals` |
| 6 | A flag in `blockFlags` (default `browser_automation`, `javascript_disabled`) | `blocked_flag` |
| 7 | A band in `blockBands` (default `dangerous`) | `blocked_band` |

```ts
// Claim the request ID before evaluating: an atomic insert-if-absent, so that two concurrent
// requests with the same ID cannot both pass. With node-redis, SET NX answers 'OK' only once.
const claimed =
  identification !== null &&
  (await redis.set(`shieldlabs:rid:${identification.request_id}`, '1', { NX: true, EX: 600 })) ===
    'OK';

const verdict = evaluateIdentification(identification, {
  maxAge: 2 * 60_000,
  blockBands: ['dangerous'],
  blockFlags: ['browser_automation', 'javascript_disabled', 'tor'],
  isReplay: () => !claimed,
});
// A Tor identification: { ok: false, reason: 'blocked_flag', band: 'dangerous', flag: 'tor' }
```

The defaults are a starting point to tune for each protected action. One identification should
authorize one action, and the SDK keeps no state: `isReplay` must answer synchronously, so claim
the request ID in a shared store first and pass the result. Use an atomic insert-if-absent (Redis
`SET key 1 NX EX 600`, or an insert into a table with a unique key on the request ID), not a
lookup followed by a separate write, which lets two concurrent requests with the same ID both
pass. If the protected action does not go ahead after a passing check, you can delete the claim
so the request ID can be used again.

A few rules that keep decisions sound:

- Branch on `detection_flags` and `risk_score`. Signal names are for display and logs.
- Never sum signal weights yourself: weights can be negative or informational.
- `riskBand(score)` returns `trusted` (0-29), `suspicious` (30-59) or `dangerous` (60-100), and
  `rate_limited` for the 999 marker, which is never a score (`isRateLimited(score)` checks it).
- The device ID `00000000-0000-0000-0000-000000000000` (`NIL_UUID`) means no usable device
  signals reached ShieldLabs.

### Search history for account-abuse checks

`history.search(type, value)` reads identifications by one identifier, newest first. Lookup types
are `user_hid`, `device_id`, `visitor_id`, `ip` (IPv4), `request_id`, `session_id` and
`cookie_id`. Arguments are validated before anything is sent, because the server does not reject
an unknown type or a malformed UUID or IP.

```ts
import { NIL_UUID } from '@shieldlabs-ai/node';

// User HID values that do not name one of your accounts (null is skipped as well).
const NOT_AN_ACCOUNT = new Set(['anonymous', 'fail', '-1', 'unknown']);

// How many accounts has this device been used with? (The all-zero device ID groups
// identifications without device signals, so skip it.)
const accounts = new Set<string>();
if (identification.device_id !== NIL_UUID) {
  for await (const item of shieldlabs.history.iterate('device_id', identification.device_id, { maxItems: 500 })) {
    if (item.user_hid !== null && !NOT_AN_ACCOUNT.has(item.user_hid)) accounts.add(item.user_hid);
  }
}
if (accounts.size >= 3) {
  // Route the signup to review.
}

// One page at a time:
const page = await shieldlabs.history.search('user_hid', hashedUserId, { limit: 50, offset: 0 });
console.log(page.total, page.data.map((item) => item.public_ip.country)); // "Germany", "France", ...
```

`history.iterate` pages with `offset` (100 rows per request by default), skips rows repeated
across pages by `request_id` (new rows can shift offsets) and stops at `total`, at an empty page
or after `maxItems`. Each request counts toward the History API rate limit.

A User HID is sent as one URL path segment in canonical form, so values with `@`, `+`, `=` or
spaces (an email address, a base64 string) match exactly. A value that contains `/`, and the
values `.` and `..`, cannot be searched and throw `ValidationError`. User HIDs from `userHid()`
are 64 hex characters and always work.

### Receive webhooks

Every scored identification is sent to each enabled endpoint as a signed `POST`. Verify the
signature over the exact bytes you received, before parsing anything:

```js
import express from 'express';
import { SignatureVerificationError, webhooks } from '@shieldlabs-ai/node';

const app = express();

// express.raw keeps the body as a Buffer. Register this route before any global express.json().
app.post('/webhooks/shieldlabs', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = webhooks.constructEvent(req.body, req.get('x-shield-signature'), process.env.SHIELDLABS_WEBHOOK_SECRET);
  } catch (error) {
    return res.sendStatus(error instanceof SignatureVerificationError ? 401 : 400);
  }
  res.sendStatus(200); // answer within 1 second, then process

  if (event.event_type === 'identification.scored') {
    jobs.enqueue(event.data); // make the job idempotent on event.data.request_id
  }
});
```

What to know about deliveries:

- The header is `X-Shield-Signature: sha256=<hex HMAC-SHA256 of the raw body>`, keyed with the
  full signing secret including its `whsec_` prefix. It is the only ShieldLabs header, so the
  idempotency key comes from the body: `data.request_id`.
- Today each identification is delivered once per enabled endpoint: one attempt with a 1-second
  timeout and no retries. Future retries will resend identical bytes, so make handlers
  idempotent on `data.request_id` now.
- For guaranteed reads, use the History API: a missed delivery is not sent again, and a History
  row can be refined after its webhook was sent.
- To rotate a secret without downtime, pass both secrets: `constructEvent(body, header, [newSecret, oldSecret])`.
  In an environment variable, keep them comma-separated and split them:
  `process.env.SHIELDLABS_WEBHOOK_SECRET!.split(',').map((secret) => secret.trim())`.
- `event_type` is `identification.scored`, `webhook.ping` (Verify in the analytics dashboard, no
  `data`) or an event type this version does not know yet, returned as an `UnknownWebhookEvent`
  with the parsed body in `raw` instead of throwing.
- The Test delivery from the analytics dashboard parses like production traffic; flags it does
  not carry are `false`.

`webhooks.verifySignature(payload, header, secret)` returns a boolean instead of throwing.

### Read the domain profile

The Management API returns the remaining included identifications of the account and the masked
keys of the domain.

```ts
import { ShieldLabsManagement } from '@shieldlabs-ai/node';

const management = new ShieldLabsManagement({
  secretKey: process.env.SHIELDLABS_SECRET_KEY!,
  domain: process.env.SHIELDLABS_DOMAIN!, // "https://www.Example.com/" is sent as "example.com"
});

const profile = await management.getProfile();
// { domain: 'example.com', remaining_identifications: 148230, public_key_masked: '****...a3f8', ... }
```

`remaining_identifications` is negative when the account is over its included volume. Call the
Management API sparingly and cache the profile: it allows about 15 requests per minute per IP and
then blocks the IP for 10 minutes, so this client never retries a 429.

### Create a User HID

The browser agent links identifications to your accounts through a User HID. Compute it on your
server and pass it to the browser SDK, instead of a raw email address or account ID:

```ts
import { userHid } from '@shieldlabs-ai/node';

// hidSecret: a long random value you create once and keep on your server. Changing it changes
// every User HID, so treat it as permanent.
const hid = userHid(user.id, hidSecret); // HMAC-SHA256, 64 lowercase hex characters
```

The same account always gets the same User HID, and the value cannot be reversed. Search its
history with `history.search('user_hid', hid)`.

### Rate limits

| API | Limit | What the SDK does |
|---|---|---|
| History API | About 15 requests per second per domain, shared by every caller of that domain | `identifications.get` polls on a backoff schedule, and inside its wait a 429 waits at least 1 s. Ordinary calls (`history.search`, `history.iterate`, `identifications.get` with `wait: false`) follow `Retry-After` as sent, up to 10 s, and wait at least 1 s after a 429 without it |
| Management API | About 15 requests per minute per IP, then the IP is blocked for 10 minutes | A 429 is raised at once, never retried |

History reads and Management calls never use your included identifications.

### Edge runtimes, Bun and Deno

Bundlers and runtimes that set the `worker`, `workerd`, `edge-light`, `browser` or `deno` export
condition get a build that uses only `fetch` and WebCrypto and never loads `node:crypto`. There,
use the Async webhook helpers; the synchronous ones throw an error that points to them.

The `browser` condition serves edge bundlers. The Private API Key and the Secret Key belong on
your server: a client created in a web page (a `window` with a `document`) prints a one-time
warning, because every visitor could read its key there.

```ts
// Cloudflare Worker
import { webhooks } from '@shieldlabs-ai/node';

export default {
  async fetch(request: Request, env: { SHIELDLABS_WEBHOOK_SECRET: string }): Promise<Response> {
    const body = new Uint8Array(await request.arrayBuffer());
    try {
      const event = await webhooks.constructEventAsync(body, request.headers.get('x-shield-signature'), env.SHIELDLABS_WEBHOOK_SECRET);
      // handle event
      return new Response(null, { status: 200 });
    } catch {
      return new Response(null, { status: 401 });
    }
  },
};
```

`userHidAsync` computes a User HID with WebCrypto. Bun resolves the Node.js build, where both
flavors work.

## Reference

### `new ShieldLabs(options)`

History API client, authenticated with the Private API Key of one domain. Safe for concurrent use:
create one per process.

| Option | Default | Notes |
|---|---|---|
| `apiKey` | required | Private API Key (`sec_...`), visible ASCII characters only. A key in another format triggers a one-time warning |
| `baseUrl` | `https://account.shieldlabs.ai` | Origin of the History API; a trailing `/api` is removed |
| `timeout` | `10000` | Milliseconds per HTTP attempt |
| `maxRetries` | `2` | Retries for connection errors, timeouts, 429 and 5xx |
| `fetch` | global `fetch` | Custom fetch implementation |
| `allowInsecureHttp` | `false` | Accept a plain http `baseUrl` on a host other than `localhost`, `127.0.0.1` or `[::1]`, for a test server. Without it such a URL throws `ValidationError` |

| Method | Returns | Notes |
|---|---|---|
| `identifications.get(requestId, { wait?, timeout?, pollInterval?, signal? })` | `Promise<Identification \| null>` | `wait` true, `timeout` 10 000 ms (total budget of the wait), `pollInterval` 250 ms by default. `pollInterval` p gives waits of p, 2p, 4p, 6p and then 8p, each at most max(2 s, p). See [Wait for the verdict](#wait-for-the-verdict) |
| `history.search(type, value, { limit?, offset?, signal? })` | `Promise<HistoryPage>` | `limit` 1-100 (default 20), `offset` 0 or more (default 0). A `user_hid` value cannot contain `/` |
| `history.iterate(type, value, { pageSize?, maxItems?, signal? })` | `AsyncGenerator<Identification>` | `pageSize` 1-100 (default 100), `maxItems` 0 or more (default no limit; 0 yields nothing) |

### `new ShieldLabsManagement(options)`

| Option | Default | Notes |
|---|---|---|
| `secretKey` | required | Secret Key of the domain, visible ASCII characters only |
| `domain` | required | Registered domain; trimmed, lowercased, without scheme, path or leading `www.`. International domains in punycode (`xn--...`) |
| `baseUrl` | `https://api.shieldlabs.ai` | Origin of the Management API |
| `timeout` | `10000` | Milliseconds per HTTP attempt |
| `maxRetries` | `2` | Retries for connection errors, timeouts and 5xx (never 429) |
| `fetch` | global `fetch` | Custom fetch implementation |
| `allowInsecureHttp` | `false` | Same as for `ShieldLabs` |

| Method | Returns |
|---|---|
| `getProfile({ signal? })` | `Promise<DomainProfile>` |

### Functions and constants

| Export | Description |
|---|---|
| `webhooks.verifySignature(payload, header, secret)` | `boolean`. `payload`: string, `Uint8Array`/`Buffer` or `ArrayBuffer`; `secret`: string or list |
| `webhooks.constructEvent(payload, header, secret)` | `WebhookEvent`; throws `SignatureVerificationError` or `WebhookParseError` |
| `webhooks.verifySignatureAsync(...)`, `webhooks.constructEventAsync(...)` | Promise-based equivalents for every runtime |
| `evaluateIdentification(identification, options?)` | `{ ok, reason, band, flag? }` (see [Apply a policy](#apply-a-policy)) |
| `riskBand(score)` | `'trusted' \| 'suspicious' \| 'dangerous' \| 'rate_limited'` |
| `isRateLimited(score)` | `true` for the 999 marker (any score above 100) |
| `userHid(userId, secret)`, `userHidAsync(userId, secret)` | HMAC-SHA256 User HID as 64 lowercase hex characters |
| `SIGNALS` | Known risk signal slugs, for example `SIGNALS.VPN === 'vpn'`. Signal names are an open set |
| `RISK_BANDS` | `{ trusted: { min: 0, max: 29 }, suspicious: { min: 30, max: 59 }, dangerous: { min: 60, max: 100 } }` |
| `NIL_UUID` | `'00000000-0000-0000-0000-000000000000'` |
| `VERSION` | SDK version, also sent in the `User-Agent` header |

### `Identification`

The same shape whether it comes from a webhook or from a History row. Property names follow the
webhook JSON.

| Property | Type | Notes |
|---|---|---|
| `request_id`, `visitor_id`, `device_id`, `session_id`, `cookie_id` | `string` | UUIDs; the all-zero UUID is possible |
| `user_hid` | `string \| null` | `"anonymous"` for anonymous checks; `null` when it was empty |
| `domain` | `string` | Registered domain of the site |
| `public_ip`, `local_ip` | `{ ip, country }` | IPv4 or `""`; English country name (`"Germany"`) or `""` |
| `connection_type` | `string` | `direct`, `mobile`, `vpn`, `proxy`, `tor`, `privacy_relay`, `browser_vpn_proxy`, `unknown` |
| `os`, `browser`, `device_type` | `string` | `device_type` is `desktop`, `mobile`, `tablet` or `unknown` |
| `traffic_source` | object | `channel`, `referrer_domain`, `landing_url`, `click_id_type`, `utm_*` (`""` when absent) |
| `risk_score` | `number` | 0-100, or 999 for the rate-limit marker |
| `signals` | `{ name, weight, description }[]` | Weighted risk signals; `description` is `null` for webhooks |
| `detection_flags` | object of 19 booleans | `vpn`, `privacy_relay`, `browser_vpn_proxy`, `tor`, `proxy`, `datacenter_ip`, `abuser`, `os_mismatch`, `os_not_detected`, `timezone_mismatch`, `anti_detect_browser`, `browser_automation`, `ip_mismatch`, `incognito`, `search_bot`, `suspicious_paid_click`, `javascript_disabled`, `stun_not_checked`, `check_incomplete` |
| `observed_at` | `string \| null` | RFC 3339 UTC with milliseconds, for example `2026-09-30T12:34:56.123Z` |
| `source` | `'webhook' \| 'history'` | Which payload it was built from |
| `raw` | object | The original payload, including fields the model omits |

Other exported types: `IdentificationSignal`, `DetectionFlags`, `TrafficSource`, `IpInfo`,
`HistoryPage`, `DomainProfile`, `WebhookEvent` (`IdentificationScoredEvent`, `WebhookPingEvent`,
`UnknownWebhookEvent`), `LookupType`, `RiskBand`, `Evaluation` and the option types.

## Errors and retries

Every error extends `ShieldLabsError`.

| Class | When |
|---|---|
| `ValidationError` | Invalid arguments, detected before any request is sent |
| `ApiError` | Any other error status, or a response body the SDK cannot use; has `status`, `body`, `headers` |
| `BadRequestError` | 400 |
| `AuthenticationError` | 401 or 403: wrong key, secret or domain, or a disabled domain |
| `QuotaExceededError` | 402. Neither the History API nor the Management API returns it today: an account over its included volume shows a negative `remaining_identifications` |
| `NotFoundError` | 404: usually a wrong base URL |
| `RateLimitError` | 429; `retryAfter` holds the seconds from `Retry-After` when present |
| `ServerError` | 5xx, including gateway errors |
| `ConnectionError` | The request never got a response; the message names the network cause, for example `connect ECONNREFUSED` |
| `TimeoutError` | An attempt took longer than `timeout` |
| `SignatureVerificationError` | Missing, malformed or wrong `X-Shield-Signature`, or no secret |
| `WebhookParseError` | The body is authentic but is not a usable event |

Requests are retried (`maxRetries`, default 2) on connection errors, timeouts, 429 and 5xx, with
exponential backoff and jitter (0.5 s base, doubling, capped at 8 s). `Retry-After` is followed as
sent, capped at 10 s (`0` retries at once), and a 429 without it waits at least 1 s. 400, 401, 402,
403 and 404 are never retried, and neither is a Management API 429.
While `identifications.get` waits for a verdict, its polling schedule takes the place of these
retries: one attempt per poll (see [Wait for the verdict](#wait-for-the-verdict)).
Pass an `AbortSignal` as `signal` to cancel a call; it rejects with the signal's reason. Error
messages never include keys or secrets: a key, secret or domain with characters that cannot be
sent in an HTTP header (line breaks, NUL, spaces, non-ASCII) throws `ValidationError` when the
client is created, without repeating the value.

## Compatibility

- Node.js 18, 20, 22 and 24, tested in CI. The package is also designed for Bun, Deno, Cloudflare
  Workers and Vercel Edge Functions: their builds use only `fetch` and WebCrypto.
- ESM and CommonJS builds with TypeScript declarations.
- Webhook schema version `2026-06-01`. Unknown fields, flags and event types are tolerated; an
  unknown `schema_version` is accepted with a one-time warning.
- Semantic versioning: breaking changes only in a new major version.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test -- --coverage
npm run build
npm run test:package   # export conditions, edge bundles, published files
npm run test:runtime   # built package, Node.js entry and edge entry
npm run test:example   # examples/node-http end to end
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Documentation: [docs.shieldlabs.ai](https://docs.shieldlabs.ai).
Support: [contact@shieldlabs.ai](mailto:contact@shieldlabs.ai).

## License

[MIT](LICENSE)
