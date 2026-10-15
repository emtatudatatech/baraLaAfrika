/*
 * End-to-end API server: the real Netlify Function handlers, served over HTTP on an in-memory
 * Postgres (PGlite) with every migration and the committed seeds loaded. Playwright starts it
 * and `vite preview` proxies /api to it, so e2e tests exercise the real API without Neon.
 */
import { createServer } from 'node:http';

import type { Context } from '@netlify/functions';

import { seededDb } from '../db/tests/seededDb.ts';
import countries from '../netlify/functions/countries.ts';
import country from '../netlify/functions/country.ts';
import coverage from '../netlify/functions/coverage.ts';
import { setDbForTesting } from '../netlify/functions/_shared/db.ts';
import regions from '../netlify/functions/regions.ts';

type Handler = (request: Request, context: Context) => Promise<Response>;

const PORT = Number(process.env.E2E_API_PORT ?? 4174);
const pg = await seededDb();
setDbForTesting({
  async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
    return (await pg.query<Row>(text, [...params])).rows;
  },
});

/** Mirrors each function's config.path (URLPattern). */
const routes: [URLPattern, Handler][] = [
  [new URLPattern({ pathname: '/api/regions' }), regions],
  [new URLPattern({ pathname: '/api/countries' }), countries],
  [new URLPattern({ pathname: '/api/countries/:iso3' }), country],
  [new URLPattern({ pathname: '/api/coverage' }), coverage],
];

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
    for (const [pattern, handler] of routes) {
      const match = pattern.exec(url);
      if (match) {
        const params = match.pathname.groups as Record<string, string>;
        response = await handler(request, { params } as unknown as Context);
        break;
      }
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  })();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`e2e API listening on http://127.0.0.1:${String(PORT)}`);
});
