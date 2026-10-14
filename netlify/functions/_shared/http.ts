import { createHash } from 'node:crypto';

import { API_ERROR_CODES, type ApiError, type ApiErrorCode } from '@bla/shared';

/** Reference data changes rarely: cache at the CDN for an hour, serve stale for a day. */
export const REFERENCE_CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

function weakEtag(body: string): string {
  return `W/"${createHash('sha1').update(body).digest('base64url')}"`;
}

/**
 * JSON response with CDN caching and a weak ETag; answers 304 when the client's
 * If-None-Match matches.
 */
export function jsonResponse(
  request: Request,
  payload: unknown,
  { cacheControl = REFERENCE_CACHE_CONTROL }: { cacheControl?: string } = {},
): Response {
  const body = JSON.stringify(payload);
  const etag = weakEtag(body);
  const headers = { ...JSON_HEADERS, 'Cache-Control': cacheControl, ETag: etag };
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch?.split(',').some((tag) => tag.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  [API_ERROR_CODES.badRequest]: 400,
  [API_ERROR_CODES.notFound]: 404,
  [API_ERROR_CODES.methodNotAllowed]: 405,
  [API_ERROR_CODES.internal]: 500,
  [API_ERROR_CODES.unavailable]: 503,
};

/** Error response in the API's consistent shape `{ error: { code, message } }`; never cached. */
export function errorResponse(code: ApiErrorCode, message: string): Response {
  const payload: ApiError = { error: { code, message } };
  return new Response(JSON.stringify(payload), {
    status: STATUS_BY_CODE[code],
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
  });
}
