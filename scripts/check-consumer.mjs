// Install the actual tarball in an isolated project, with no workspace or sibling dependencies.
// Run after build. Deliberately skip prepack so stale dist files fail rather than being repaired.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'shieldlabs-node-consumer-'));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
function npm(args, cwd) {
  const commandArgs = ['--cache', join(temporary, 'npm-cache'), ...args];
  return execFileSync(
    npmCli ? process.execPath : 'npm',
    npmCli ? [npmCli, ...commandArgs] : commandArgs,
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

try {
  const [packed] = JSON.parse(
    npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root),
  );
  writeFileSync(
    join(temporary, 'package.json'),
    JSON.stringify({ name: 'sdk-consumer-test', private: true, type: 'module' }),
  );
  npm(
    [
      'install',
      join(temporary, packed.filename),
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ],
    temporary,
  );
  const installedManifest = JSON.parse(
    readFileSync(join(temporary, 'node_modules/@shieldlabs-ai/node/package.json'), 'utf8'),
  );
  assert.equal(installedManifest.version, manifest.version);
  const fixture = readFileSync(join(root, 'test/consumer/usage.ts.txt'), 'utf8');
  const consumer = `${fixture}\nconst packageVersion: ${JSON.stringify(manifest.version)} = VERSION;\nvoid packageVersion;\n`;
  for (const [filename, module, resolution] of [
    ['consumer.mts', 'NodeNext', 'NodeNext'],
    ['consumer.cts', 'NodeNext', 'NodeNext'],
    ['consumer.ts', 'ESNext', 'Bundler'],
  ]) {
    writeFileSync(join(temporary, filename), consumer);
    execFileSync(
      process.execPath,
      [
        join(root, 'node_modules/typescript/bin/tsc'),
        filename,
        '--strict',
        '--exactOptionalPropertyTypes',
        '--noUncheckedIndexedAccess',
        '--noEmit',
        '--target',
        'ES2022',
        '--lib',
        'ES2022,DOM',
        '--module',
        module,
        '--moduleResolution',
        resolution,
      ],
      { cwd: temporary, encoding: 'utf8', stdio: 'pipe' },
    );
    console.log(`ok   packed declarations: ${filename} (${resolution})`);
  }

  const runtime = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ShieldLabs, ShieldLabsManagement, VERSION } from '@shieldlabs-ai/node';
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(require.resolve('@shieldlabs-ai/node/package.json'), 'utf8'));
assert.equal(VERSION, manifest.version);
assert.equal(require('@shieldlabs-ai/node').VERSION, manifest.version);
const row = { request_id: 'a5b7c9d1-e3f5-4a7b-9c1d-3e5f7a9b1c3d', score: 999, connection_type: 'future_connection', future_field: true };
const client = new ShieldLabs({ apiKey: 'sec_12345678-12345678-12345678', fetch: async () => new Response(JSON.stringify({ data: [row], total: 1 })) });
const page = await client.history.search('user_hid', 'example', { limit: 1 });
assert.equal(page.total, 1);
assert.equal(page.data[0].risk_score, 999);
assert.equal(page.data[0].connection_type, 'future_connection');
assert.equal(page.data[0].observed_at, null);
assert.equal(page.data[0].detection_flags.vpn, false);
assert.equal(page.data[0].raw.future_field, true);
const management = new ShieldLabsManagement({ secretKey: 'example_secret', domain: 'example.com', fetch: async () => new Response(JSON.stringify({ Domain: 'example.com', Weight: -1, PublicKey: '****1234', Secret: '****5678', CreatedAt: '', future_field: true })) });
const profile = await management.getProfile();
assert.equal(profile.remaining_identifications, -1);
assert.equal(profile.created_at, null);
assert.equal(profile.raw.future_field, true);
console.log('ok   packed runtime and VERSION: ' + VERSION);
`;
  writeFileSync(join(temporary, 'runtime.mjs'), runtime);
  for (const conditions of [[], ['--conditions=worker']]) {
    const output = execFileSync(process.execPath, [...conditions, 'runtime.mjs'], {
      cwd: temporary,
      encoding: 'utf8',
    });
    console.log(output.trim());
  }

  // Prove the runtime guard rejects stale dist rather than accepting the manifest alone.
  // Only the disposable installed copy is changed; the source and build are untouched.
  const installedEntry = join(temporary, 'node_modules/@shieldlabs-ai/node/dist/index.js');
  const entry = readFileSync(installedEntry, 'utf8');
  const versionDeclaration = `var VERSION = ${JSON.stringify(manifest.version)};`;
  assert.equal(entry.split(versionDeclaration).length, 2);
  writeFileSync(installedEntry, entry.replace(versionDeclaration, 'var VERSION = "0.0.0-stale";'));
  assert.throws(
    () =>
      execFileSync(process.execPath, ['runtime.mjs'], {
        cwd: temporary,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    (error) =>
      error.status === 1 &&
      error.stderr.includes('ERR_ASSERTION') &&
      error.stderr.includes('0.0.0-stale'),
  );
  console.log('ok   a stale runtime VERSION in the installed tarball is rejected');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
