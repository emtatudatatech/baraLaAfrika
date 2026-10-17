/*
 * Local API server: the real Netlify Function handlers, served over HTTP on an in-memory
 * Postgres (PGlite) with every migration and the committed seeds loaded. Playwright starts it
 * and `vite preview` proxies /api to it, so e2e tests exercise the real API without Neon;
 * `npm run dev:local` uses it the same way behind the Vite dev server.
 */
import { createServer } from 'node:http';

import type { Context } from '@netlify/functions';

import { seededDb } from '../db/tests/seededDb.ts';
import { setDbForTesting } from '../netlify/functions/_shared/db.ts';
import { matchingFunctions } from '../netlify/tests/functionRoutes.ts';

const PORT = Number(process.env.E2E_API_PORT ?? 4174);
const pg = await seededDb();
setDbForTesting({
  async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
    return (await pg.query<Row>(text, [...params])).rows;
  },
});

createServer((incoming, outgoing) => {
  void (async () => {
    const url = new URL(incoming.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    const request = new Request(url, { method: incoming.method ?? 'GET', headers });
    let response = Response.json(
      { error: { code: 'not_found', message: 'Function not found' } },
      { status: 404 },
    );
    try {
      const [match, ...others] = matchingFunctions(url.pathname);
      if (others.length > 0) throw new Error(`Several functions match ${url.pathname}`);
      if (match) {
        response = await match.handler(request, { params: match.params } as unknown as Context);
      }
    } catch (error) {
      // Never take the server down; answer like the deployed functions do.
      console.error(error);
      response = Response.json(
        { error: { code: 'internal_error', message: 'Internal error' } },
        { status: 500 },
      );
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  })();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Local API (seed data, in-memory Postgres) on http://127.0.0.1:${String(PORT)}`);
});
