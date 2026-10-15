/*
 * `npm run dev:local`: the Vite dev server plus the local API (the real function handlers on an
 * in-memory Postgres loaded with the committed seeds; see e2e/api-server.ts). No database or
 * network connection is needed. Ctrl+C stops both.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'apps/web');
const API_PORT = process.env.LOCAL_API_PORT ?? '4175';
const API_URL = `http://127.0.0.1:${API_PORT}`;
// Vite's own CLI, run directly (not through npm) so Ctrl+C stops it cleanly.
const VITE_BIN = join(
  dirname(createRequire(join(WEB, 'package.json')).resolve('vite/package.json')),
  'bin/vite.js',
);

const children = [];
let stopping = false;

function start(args, { cwd, env }) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    // Either process ending ends the session (e.g. the API failed to start).
    if (!stopping) stop('SIGTERM', code ?? (signal ? 1 : 0));
  });
  return child;
}

function stop(signal, code) {
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

// A terminal Ctrl+C already reaches both children (same process group); forwarding the same
// signal also covers a signal sent to this process alone.
process.on('SIGINT', () => stop('SIGINT', 0));
process.on('SIGTERM', () => stop('SIGTERM', 0));

async function waitForApi(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(`${API_URL}/api/regions`);
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

start(['e2e/api-server.ts'], { cwd: ROOT, env: { E2E_API_PORT: API_PORT } });
if (await waitForApi()) {
  start([VITE_BIN], { cwd: WEB, env: { BLA_API_PROXY: API_URL } });
} else if (!stopping) {
  console.error(`The local API did not start on ${API_URL}.`);
  stop('SIGTERM', 1);
}
