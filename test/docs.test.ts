// Checks the documents this repository publishes: README structure, example IP addresses,
// changelog and license.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'data']);
const TEXT_FILE = /\.(ts|mjs|js|md|yml|json)$/;

function collect(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) files.push(...collect(path));
    } else if (TEXT_FILE.test(name) && name !== 'package-lock.json') {
      files.push(relative(root, path));
    }
  }
  return files;
}

const files = [...collect(root), 'test/data/README.md'];
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const docs = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'examples/node-http/README.md',
  'test/data/README.md',
];

describe('repository documents', () => {
  it('finds the docs, source and examples', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'README.md',
        'src/index.ts',
        'examples/node-http/server.mjs',
        '.github/workflows/ci.yml',
      ]),
    );
  });

  it('uses documentation IP ranges in docs, source and examples', () => {
    const scope = files.filter(
      (file) => docs.includes(file) || file.startsWith('src/') || file.startsWith('examples/'),
    );
    const allowed = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$|^(0\.0\.0\.0|127\.0\.0\.1)$/;
    const found = scope.flatMap((file) =>
      (read(file).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).map((ip) => `${file}: ${ip}`),
    );
    expect(found.filter((entry) => !allowed.test(entry.split(': ')[1] ?? ''))).toEqual([]);
  });

  it('keeps the README structure and call to action', () => {
    const readme = read('README.md');
    const headings = readme
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3));
    expect(headings).toEqual([
      'How it fits',
      'Install',
      'Quick start',
      'Guide',
      'Reference',
      'Errors and retries',
      'Compatibility',
      'Development',
      'License',
    ]);
    expect(readme).toContain('Start free');
    expect(readme).toContain('trusted` (0-29), `suspicious` (30-59) or `dangerous` (60-100)');
    expect(readme).toContain('https://docs.shieldlabs.ai');
    expect(readme).toContain('contact@shieldlabs.ai');
  });

  it('documents version 1.0.0 in the changelog', () => {
    expect(read('CHANGELOG.md')).toContain('## [1.0.0] - 2026-09-30');
  });

  it('carries the MIT license of ShieldLabs Inc.', () => {
    expect(read('LICENSE')).toContain('Copyright (c) 2026 ShieldLabs Inc.');
  });
});
