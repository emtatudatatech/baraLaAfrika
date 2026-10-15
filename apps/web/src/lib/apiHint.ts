import { ApiRequestError } from './api';
import { strings } from './strings';

/** Errors that mean "no API answered" rather than an API error response. */
const UNREACHABLE = new Set(['network_error', 'invalid_response', 'http_error']);

/**
 * A development-only explanation for a failed API call, e.g. when `npm run dev` serves the site
 * without an API. Returns null in production builds and for genuine API errors.
 */
export function devApiHint(error: unknown, dev: boolean = import.meta.env.DEV): string | null {
  if (!dev || !(error instanceof ApiRequestError)) return null;
  if (error.code === 'service_unavailable') return strings.devHints.noDatabase;
  return UNREACHABLE.has(error.code) ? strings.devHints.apiNotRunning : null;
}
