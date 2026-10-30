# Changelog

## [1.3.2] - 2026-10-30

- Recognize schema `2026-10-07` for signed `hre.multi_account.changed` events without an incorrect scored-schema warning in Node.js and edge runtimes.
- Scope unknown-schema diagnostics to the event type and version; preserve the original signed envelope without claiming that every different schema is newer.

## [1.3.1] - 2026-10-30

- Use one string for the user-list `ids` filter; reject multiple ids before HTTP. Existing single-element arrays remain usable at runtime for installed 1.x integrations.
- Remove unsupported relation inputs from entity-card options.
- Refresh generated types from the current OpenAPI; keep bands, signals, source and campaign repeatable.

## [1.3.0] - 2026-10-29

- History lists and cards take flat query filters (`risk_bands`, flags, `risk_signals`, `source`, `campaign`). `entities.domains()` returns the public domain id.
- `history.search` and `history.iterate` no longer call the retired `/api/v1/history/{type}/{value}` route. `identifications.get` reads `/api/v1/domains/{domainId}/history/identifications/{id}`.
- Validate returned domain/resource/ID and reject malformed risk states without synthesizing Score 0.
- Document the current entities API separately from retired row-search routes.
- Use `banned_ip` for the public signal and boolean filter. The `rate_limited` filter is rejected; HTTP 429 errors keep their `rate_limited` code.
- Export `fromHistoryRow` so a raw History row can be normalized without calling the retired search route.

## [1.2.0] - 2026-10-28

- Add domain-scoped entity History lists and cards with opaque pagination and preserved risk availability. Lists do not send sort, identification id filters, device_id_source or chips.
- Validate returned domain/resource/ID and reject malformed risk states without synthesizing Score 0.
- Document the current entities API separately from retired row-search routes.

All notable changes to this package are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-28

### Changed

- Normalized identifications use `identification_id`. When updating from 1.0.1,
  replace reads of `identification.request_id` with `identification.identification_id`.
  History still accepts the legacy `request_id` input; MCP arguments stay `request_id`.
- Detection flags follow webhook schema `2026-10-13`: 20 public booleans, including
  `latency_test`, `device_spoofing`, `banned_ip`, `ai_bot` and `ai_browser`.

### Fixed

- Preserve current identification UUIDs from History and signed webhook payloads.
- Accept opaque webhook event IDs, including production hex IDs, separately from
  identification UUIDs. A Test delivery and a real visit remain distinct checks.

## [1.0.1] - 2026-10-01

### Fixed

- Published as 1.0.1. Version 1.0.0 remained an unfinished npm publish and could not be installed. The library code is unchanged.

## [1.0.0] - 2026-09-30

### Added

- `ShieldLabs` History API client: `identifications.get` with wait-for-verdict polling,
  `history.search`, and `history.iterate` with deduplication on `identification_id`.
- `identifications.get` waits within one total `timeout` budget (default 10 s): the first poll
  runs at once, then after 250 ms, 500 ms, 1 s, 1.5 s and every 2 s, and the last poll runs at
  the deadline. A custom `pollInterval` p gives waits of p, 2p, 4p, 6p and then 8p, each capped
  at 2 s or at p when p is longer, so 1 s waits 1 s and then every 2 s, and 3 s polls every 3 s.
  Each poll is one HTTP attempt without retries; its timeout is the client timeout, shortened to
  the time left but at least 1 s. A 429, a 5xx, a connection error or a timeout keeps it
  polling. After a 429 the next wait is the longest of the scheduled wait, 1 s and its
  `Retry-After` capped at 10 s (a missing `Retry-After`, `0` or a past date counts as 0), cut
  short at the deadline; a capped `Retry-After` longer than the time left is thrown at once. At
  the deadline the error of the last poll is thrown, or `null` is returned when that poll found
  nothing. 400, 401, 403 and 404 are thrown at once.
- Client-side validation of lookup types, UUIDs, IPv4 addresses, `limit` and `offset`: invalid
  arguments throw `ValidationError` and send nothing.
- User HID lookups are sent in canonical path form (`@`, `+`, `=`, `:` and similar characters
  stay as they are), so such values match. A User HID that contains `/`, or is `.` or `..`,
  throws `ValidationError`, because the History API cannot search it.
- `ShieldLabsManagement` client with `getProfile()`, domain normalization and no retries on 429.
- Keys, secrets and domains are checked when a client is created: a value with characters that
  cannot be sent in an HTTP header (line breaks, NUL, spaces, non-ASCII) throws
  `ValidationError`, and no error message or cause repeats a key or secret. `ConnectionError`
  messages name the network cause, for example `connect ECONNREFUSED`.
- `webhooks.verifySignature` and `webhooks.constructEvent`, plus `verifySignatureAsync` and
  `constructEventAsync` for every runtime. One secret or a list of secrets for rotation. Typed
  `IdentificationScoredEvent`, `WebhookPingEvent` and `UnknownWebhookEvent`.
- One `Identification` model for webhook deliveries and History rows: 19 detection flags, weighted
  risk signals and `observed_at` as RFC 3339 UTC with milliseconds.
- `evaluateIdentification`, `riskBand`, `isRateLimited`, `userHid`, `userHidAsync`, `SIGNALS`,
  `RISK_BANDS`, `NIL_UUID` and `VERSION`. `evaluateIdentification` with `maxAge: Infinity` skips
  the freshness check.
- Base URLs must use https. Plain http is accepted for `localhost`, `127.0.0.1` and `[::1]`, and
  for other hosts only with `allowInsecureHttp: true`, so a mistyped URL never sends a key
  unencrypted.
- Error hierarchy under `ShieldLabsError`, including `QuotaExceededError` (402); retries with
  jittered exponential backoff and `Retry-After`; per-attempt timeouts; `AbortSignal` cancellation.
- Edge build for workers, edge runtimes, Deno and browsers, selected by export conditions. It never
  loads `node:crypto`. A client created in a web page prints a one-time warning, because every
  visitor could read its key there.
- ESM and CommonJS builds with TypeScript declarations, and the `examples/node-http` app.

### Changed

- History requests go to `https://account.shieldlabs.ai/api/v1/history/...`. The preview doubled
  the `/api` prefix (`/api/api/v1/...`) and got 404 responses. A base URL that ends in `/api` is
  now normalized.

### Removed

- The preview `ShieldLabsClient` and `verifyWebhook` exports, replaced by `ShieldLabs` and
  `webhooks.verifySignature`.

## [0.1.0] - 2026-09-06

### Added

- Preview release: `verifyWebhook`, webhook payload types and a basic History API client.

[Unreleased]: https://github.com/ShieldLabs-ai/shieldlabs-node/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ShieldLabs-ai/shieldlabs-node/releases/tag/v1.0.0
