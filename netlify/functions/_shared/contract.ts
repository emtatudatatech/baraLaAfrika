/*
 * The shared API contract (types, zod schemas, constants), imported by relative path on purpose:
 * Netlify's function bundler keeps node_modules packages external and copies their files by
 * tracing JavaScript imports, which does not follow the workspace package's TypeScript source.
 * A relative import is always inlined into each function bundle by esbuild.
 */
export * from '../../../packages/shared/src/index.ts';
