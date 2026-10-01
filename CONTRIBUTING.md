# Contributing

Thank you for helping improve `@shieldlabs-ai/node`.

## Set up

Development needs Node.js 20 or later (the published package supports Node.js 18 and later).

```bash
npm ci
```

## Checks

Every change must pass these before it is merged:

```bash
npm run typecheck
npm run lint
npm test -- --coverage   # coverage must stay at or above 90%
npm run build
npm run test:package     # export conditions, edge bundles, published files
npm run test:runtime     # the built package in the Node.js and edge entries
npm run test:example     # examples/node-http end to end
```

## Guidelines

- Keep the package free of runtime dependencies.
- Only `src/index.ts` may import `node:crypto`. Everything shared by both entries (`src/common.ts`
  and what it imports) must run on `fetch` and WebCrypto alone; `npm run test:package` checks it.
- `test/data` holds shared test fixtures that every ShieldLabs server SDK passes. Do not edit
  them here; add new cases in a separate file.
- Changes to public behavior need tests and an entry under `Unreleased` in `CHANGELOG.md`.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
- Documentation is plain technical English. Say "risk signals" and use the three risk bands:
  trusted 0-29, suspicious 30-59, dangerous 60-100.

## Releases

A maintainer bumps the version in `package.json` and `src/version.ts`, updates `CHANGELOG.md`, and
pushes a tag `vX.Y.Z`. The release workflow checks and packs the package with read-only
permissions, then publishes that tarball to npm with provenance (GitHub environment `npm`,
`NPM_TOKEN` secret). Re-running it skips a version that is already on npm.

## Security

Report vulnerabilities privately to [contact@shieldlabs.ai](mailto:contact@shieldlabs.ai) instead
of opening a public issue.
