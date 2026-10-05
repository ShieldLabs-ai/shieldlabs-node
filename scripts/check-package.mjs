// Checks the built package: files, export conditions and the edge bundles. Run after npm run build.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const failures = [];
function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
  if (!condition) failures.push(label);
}

const EXPECTED_EXPORTS = [
  'ApiError',
  'AuthenticationError',
  'BadRequestError',
  'ConnectionError',
  'NIL_UUID',
  'NotFoundError',
  'QuotaExceededError',
  'RISK_BANDS',
  'RateLimitError',
  'SIGNALS',
  'ServerError',
  'ShieldLabs',
  'ShieldLabsError',
  'ShieldLabsManagement',
  'SignatureVerificationError',
  'TimeoutError',
  'VERSION',
  'ValidationError',
  'WebhookParseError',
  'evaluateIdentification',
  'isRateLimited',
  'riskBand',
  'userHid',
  'userHidAsync',
  'webhooks',
].join(',');

const files = ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts', 'edge.js', 'edge.cjs'];
for (const file of files)
  check(`dist/${file} exists`, existsSync(new URL(`../dist/${file}`, import.meta.url)));

for (const file of ['index.js', 'index.cjs', 'edge.js', 'edge.cjs']) {
  const built = await import(new URL(`../dist/${file}`, import.meta.url));
  check(`dist/${file} VERSION matches package.json (${version})`, built.VERSION === version);
}

// The edge build must never load a Node.js built-in.
const builtinImport =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:node:[\w/]+|crypto|buffer|fs|http|https|stream|util)["']/;
for (const file of ['edge.js', 'edge.cjs']) {
  const code = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
  check(`dist/${file} imports no Node.js built-in`, !builtinImport.test(code));
}
for (const file of ['index.js', 'index.cjs']) {
  const code = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
  check(`dist/${file} imports node:crypto`, /["']node:crypto["']/.test(code));
}

// The declarations must not promise a value that the bundles do not export (a type exported
// without the `type` modifier compiles, then fails at import time), and must cover every value.
const runtimeNames = EXPECTED_EXPORTS.split(',');
for (const file of ['index.d.ts', 'index.d.cts']) {
  const dts = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
  const lists = [...dts.matchAll(/^export \{([^}]*)\};?$/gm)].map((match) => match[1]);
  const valueNames = lists
    .flatMap((list) => list.split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '' && !name.startsWith('type '))
    .map((name) => name.split(/\s+as\s+/).pop());
  const extra = valueNames.filter((name) => !runtimeNames.includes(name));
  const missing = runtimeNames.filter((name) => !valueNames.includes(name));
  check(
    `dist/${file} declares exactly the runtime values${extra.length > 0 ? `; not at runtime: ${extra.join(', ')}` : ''}${missing.length > 0 ? `; undeclared: ${missing.join(', ')}` : ''}`,
    lists.length > 0 && extra.length === 0 && missing.length === 0,
  );
}

function run(args) {
  return execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' }).trim();
}

// Resolve the package by name (self-reference) under different export conditions.
const probe = `
  const names = Object.keys(m).sort().join(',');
  let entry = 'node';
  try { m.webhooks.verifySignature('x', 'sha256=' + '0'.repeat(64), 'whsec_x'); } catch (e) { entry = /Async/.test(e.message) ? 'edge' : 'error'; }
  console.log(entry + ' ' + (names === ${JSON.stringify(EXPECTED_EXPORTS)} ? 'exports-ok' : 'exports-mismatch:' + names));
`;
const esm = (conditions) =>
  run([
    ...conditions,
    '--input-type=module',
    '-e',
    `import * as m from '@shieldlabs-ai/node'; ${probe}`,
  ]);
const cjs = (conditions) =>
  run([...conditions, '-e', `const m = require('@shieldlabs-ai/node'); ${probe}`]);

check('import resolves the Node entry', esm([]) === 'node exports-ok');
check('require resolves the Node entry', cjs([]) === 'node exports-ok');
for (const condition of ['worker', 'workerd', 'edge-light', 'browser', 'deno']) {
  check(
    `import with the ${condition} condition resolves the edge entry`,
    esm([`--conditions=${condition}`]) === 'edge exports-ok',
  );
  check(
    `require with the ${condition} condition resolves the edge entry`,
    cjs([`--conditions=${condition}`]) === 'edge exports-ok',
  );
}
check('the bun condition resolves the Node entry', esm(['--conditions=bun']) === 'node exports-ok');

// Only the build output and the docs are published.
const npmCli = process.env.npm_execpath;
const packJson = npmCli
  ? execFileSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    })
  : execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    });
const packed = JSON.parse(packJson)[0]
  .files.map((entry) => entry.path)
  .sort();
const allowed =
  /^(dist\/(index|edge)\.(js|cjs|d\.ts|d\.cts|js\.map|cjs\.map)|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/;
check(
  `the tarball holds only dist, docs and package.json (${packed.length} files)`,
  packed.every((path) => allowed.test(path)),
);
check(
  'the tarball includes the type declarations',
  packed.includes('dist/index.d.ts') && packed.includes('dist/index.d.cts'),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} package check(s) failed.`);
  process.exit(1);
}
console.log('\nPackage checks passed.');
