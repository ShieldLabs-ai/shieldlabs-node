# @shieldlabs/node

ShieldLabs server SDK for Node.js: webhook verification, typed webhook events, and History API client.

Your code decides what to do with the score. This SDK never makes the decision for you.

## Install

```bash
npm install @shieldlabs/node
```

## Verify webhooks

```ts
import { verifyWebhook } from "@shieldlabs/node";
import type { WebhookEvent } from "@shieldlabs/node";

// Pass the raw body bytes exactly as received (before JSON.parse).
const ok = verifyWebhook(rawBody, req.headers["x-shield-signature"]!, process.env.SHIELDLABS_WEBHOOK_SECRET!);
if (!ok) throw new Error("invalid signature");

const event = JSON.parse(rawBody.toString()) as WebhookEvent;
if (event.event_type === "webhook.ping") return;
// handle event.data — idempotent on event.data.request_id
```

Signature: `X-Shield-Signature: sha256=` + hex(HMAC-SHA256(secret, raw_body)). Schema version `2026-06-01`.

## History API

```ts
import { ShieldLabsClient } from "@shieldlabs/node";

const client = new ShieldLabsClient({ apiKey: process.env.SHIELDLABS_API_KEY! });
const { data, total } = await client.getHistory("request_id", requestId);
```

Base URL defaults to `https://account.shieldlabs.ai/api` (Shield.Portal.Admin).

## License

[MIT](./LICENSE)
