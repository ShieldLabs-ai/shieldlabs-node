// Regenerate types after changing the schema in memory, then typecheck SDK source against them.
// No test assertions or edited working files can cause the expected compilation failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { generateApiTypes } from '../generate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const generatedPath = resolve(root, 'src/generated/api.ts');
const schema = readFileSync(resolve(root, 'resources/shieldlabs-api.yaml'), 'utf8');
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
assert.deepEqual(parsed.errors, []);
const rootNames = parsed.fileNames.filter((name) =>
  resolve(name).startsWith(resolve(root, 'src') + sep),
);

function compile(generated) {
  const host = ts.createCompilerHost(parsed.options);
  const originalRead = host.readFile.bind(host);
  host.readFile = (name) => (resolve(name) === generatedPath ? generated : originalRead(name));
  const program = ts.createProgram({ rootNames, options: parsed.options, host });
  return ts.getPreEmitDiagnostics(program);
}

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `Expected one occurrence of ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

function changeComponent(name, from, to) {
  const start = schema.indexOf(`\n    ${name}:\n`);
  assert.ok(start >= 0, `Missing component ${name}`);
  const rest = schema.slice(start + 1);
  const next = rest.search(/\n {4}[A-Za-z][A-Za-z0-9]*:\n/);
  assert.ok(next >= 0, `Missing component boundary after ${name}`);
  const end = start + 1 + next;
  return (
    schema.slice(0, start) + replaceOnce(schema.slice(start, end), from, to) + schema.slice(end)
  );
}

const baseline = await generateApiTypes(schema);
assert.equal(baseline, readFileSync(generatedPath, 'utf8'), 'Run npm run generate first.');
assert.deepEqual(compile(baseline), [], 'The unchanged SDK must compile before testing drift.');
console.log('ok   unchanged schema compiles');

const cases = [
  [
    'A new lookup type needs validation support',
    changeComponent(
      'HistorySearchType',
      '          - cookie_id\n',
      '          - cookie_id\n          - account_id\n',
    ),
    'src/validation.ts',
  ],
  [
    'History score column renamed',
    changeComponent('HistoryRow', '\n        score:\n', '\n        risk_points:\n'),
    'src/normalize.ts',
  ],
  [
    'History score changes type',
    changeComponent(
      'HistoryRow',
      "score:\n          $ref: '#/components/schemas/RiskScore'",
      'score:\n          type: string',
    ),
    'src/normalize.ts',
  ],
  [
    'History page total changes type',
    changeComponent(
      'HistoryPage',
      'total:\n          type: integer',
      'total:\n          type: string',
    ),
    'src/history.ts',
  ],
  [
    'Profile weight changes type',
    changeComponent(
      'DomainProfile',
      'Weight:\n          type: integer',
      'Weight:\n          type: string',
    ),
    'src/normalize.ts',
  ],
  [
    'History limit changes type',
    changeComponent('HistoryLimit', 'type: integer', 'type: string'),
    'src/history.ts',
  ],
  [
    'History query parameter renamed',
    changeComponent('HistoryLimit', 'name: limit', 'name: page_size'),
    'src/history.ts',
  ],
  [
    'Management domain header renamed',
    changeComponent('ShieldDomain', 'name: X-Shield-Domain', 'name: X-Site-Domain'),
    'src/management.ts',
  ],
  [
    'Webhook score changes type',
    changeComponent(
      'IdentificationScoredData',
      "risk_score:\n          $ref: '#/components/schemas/RiskScore'",
      'risk_score:\n          type: string',
    ),
    'src/normalize.ts',
  ],
  [
    'A new flag needs a normalization rule',
    changeComponent(
      'DetectionFlags',
      '      properties:\n',
      '      properties:\n        extra_flag:\n          type: boolean\n',
    ),
    'src/normalize.ts',
  ],
];

for (const [label, changedSchema, expectedFile] of cases) {
  const changedTypes = await generateApiTypes(changedSchema);
  assert.notEqual(changedTypes, baseline, `${label}: regeneration must change the types`);
  const diagnostics = compile(changedTypes);
  const relevant = diagnostics.filter(
    (diagnostic) =>
      diagnostic.file && resolve(diagnostic.file.fileName) === resolve(root, expectedFile),
  );
  assert.ok(relevant.length > 0, `${label}: SDK code must fail to compile in ${expectedFile}`);
  console.log(`ok   ${label}: ${expectedFile} rejects the incompatible schema`);
}

// Additive fields remain valid raw data; strings used for server values remain open.
const additive = changeComponent(
  'HistoryRow',
  '      properties:\n',
  '      properties:\n        future_diagnostic:\n          type: string\n',
);
assert.deepEqual(compile(await generateApiTypes(additive)), []);
console.log('ok   additive History fields remain compatible');
