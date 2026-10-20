import { ApiErrorSchema } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import { REFERENCE_CACHE_CONTROL, errorResponse, jsonResponse } from '../functions/_shared/http.ts';

describe('jsonResponse', () => {
  it('returns JSON with reference caching and an ETag', async () => {
    const response = jsonResponse(new Request('https://x.test/api/regions'), { ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(REFERENCE_CACHE_CONTROL);
    expect(response.headers.get('etag')).toMatch(/^W\/".+"$/);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers 304 when If-None-Match matches', () => {
    const first = jsonResponse(new Request('https://x.test/a'), { a: 1 });
    const etag = first.headers.get('etag') ?? '';
    const second = jsonResponse(
      new Request('https://x.test/a', { headers: { 'If-None-Match': `"other", ${etag}` } }),
      { a: 1 },
    );
    expect(second.status).toBe(304);
    expect(second.body).toBeNull();
  });
});

describe('errorResponse', () => {
  it('uses the consistent error shape and status', async () => {
    const response = errorResponse('not_found', 'No such country');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(ApiErrorSchema.parse(body)).toEqual({
      error: { code: 'not_found', message: 'No such country' },
    });
  });
});
