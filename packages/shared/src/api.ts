import { z } from 'zod';

/** Consistent error body returned by every API function. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const API_ERROR_CODES = {
  badRequest: 'bad_request',
  notFound: 'not_found',
  methodNotAllowed: 'method_not_allowed',
  internal: 'internal_error',
  unavailable: 'service_unavailable',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
