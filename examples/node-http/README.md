# node:http example

A signup endpoint and a webhook receiver on plain `node:http`, with no framework and no other
dependencies.

- `POST /signup` reads `requestId` from the JSON body, waits for the identification with
  `identifications.get`, and refuses the signup when the identification is missing, reused,
  stale, rate limited, without device signals, automated or in the dangerous band.
- `POST /webhooks/shieldlabs` verifies `X-Shield-Signature` on the raw body, answers 200 at once
  and logs each `identification.scored` delivery once per request ID.

## Run it from this repository

```bash
npm ci && npm run build
SHIELDLABS_API_KEY=sec_your_private_key \
SHIELDLABS_WEBHOOK_SECRET=whsec_your_signing_secret \
node examples/node-http/server.mjs
```

Inside this repository `@shieldlabs-ai/node` resolves to the local build. In your own project,
install the package (`npm install @shieldlabs-ai/node`) and copy `server.mjs`. While you rotate the
webhook signing secret, set `SHIELDLABS_WEBHOOK_SECRET` to the new and the old secret separated
by a comma.

## Try it

```bash
curl -s -X POST localhost:3000/signup \
  -H 'content-type: application/json' \
  -d '{"requestId":"7c1e2f4a-3b6d-4e8f-9a0b-1c2d3e4f5a6b"}'
```

The request ID comes from `identify()` in the browser SDK. Each one authorizes a single signup:
sending the same request ID twice is refused with `"reason":"replayed"`.
