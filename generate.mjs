import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const outputPath = resolve(root, 'src/generated/api.ts');

const ast = await openapiTS(new URL('./resources/shieldlabs-api.yaml', import.meta.url));
const banner = `/**
 * Generated from resources/shieldlabs-api.yaml. Do not edit by hand.
 * Refresh with: ./sync.sh && npm run generate
 */
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, banner + astToString(ast));
console.log(`Wrote ${outputPath}`);
