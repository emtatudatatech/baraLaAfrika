import { API_ERROR_CODES, type ApiErrorCode } from './contract.ts';
import type { Context } from '@netlify/functions';
import { ZodError } from 'zod';

import { DatabaseNotConfiguredError } from './db.ts';
import { errorResponse, jsonResponse } from './http.ts';

export class HttpError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
  }
}

export function queryParams(request: Request): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    params[key] ??= value; // first value wins for repeated keys
  }
  return params;
}

function describeZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `${where}${issue.message}`;
}

/**
 * Wraps an API handler: GET/HEAD only, JSON + caching on success, and the consistent
 * `{ error: { code, message } }` shape for every failure. Internal errors are logged, never
 * returned to the client.
 */
export function defineHandler(
  handle: (request: Request, context: Context) => Promise<unknown>,
): (request: Request, context: Context) => Promise<Response> {
  return async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const response = errorResponse(API_ERROR_CODES.methodNotAllowed, 'Only GET is supported');
      response.headers.set('Allow', 'GET, HEAD');
      return response;
    }
    try {
      const response = jsonResponse(request, await handle(request, context));
      return request.method === 'HEAD'
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    } catch (error) {
      if (error instanceof ZodError) {
        return errorResponse(API_ERROR_CODES.badRequest, describeZodError(error));
      }
      if (error instanceof HttpError) return errorResponse(error.code, error.message);
      if (error instanceof DatabaseNotConfiguredError) {
        return errorResponse(API_ERROR_CODES.unavailable, 'The database is not configured');
      }
      console.error(error);
      return errorResponse(API_ERROR_CODES.internal, 'Something went wrong');
    }
  };
}
