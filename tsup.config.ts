import { defineConfig } from 'tsup';

// Two entries with the same public API:
// - index: Node.js and Bun. Synchronous webhook helpers use node:crypto.
// - edge: workers, edge runtimes, Deno and browsers. Never imports node:crypto.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    edge: 'src/edge.ts',
  },
  format: ['esm', 'cjs'],
  // Both entries export the same names and signatures, so one set of declarations serves both.
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: ['node18', 'es2022'],
  platform: 'node',
  removeNodeProtocol: false,
});
