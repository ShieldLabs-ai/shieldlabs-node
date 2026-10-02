import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const outputPath = resolve(root, 'src/generated/api.ts');

const banner = `/**
 * Generated from resources/shieldlabs-api.yaml. Do not edit by hand.
 * Refresh with: ./sync.sh && npm run generate
 */
`;

export async function generateApiTypes(
  schema = new URL('./resources/shieldlabs-api.yaml', import.meta.url),
) {
  return banner + astToString(await openapiTS(schema));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = await generateApiTypes();
  if (process.argv.includes('--check')) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== generated) {
      console.error('src/generated/api.ts is stale. Run npm run generate and commit the result.');
      process.exitCode = 1;
    } else {
      console.log('Generated API types are up to date.');
    }
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, generated);
    console.log(`Wrote ${outputPath}`);
  }
}
