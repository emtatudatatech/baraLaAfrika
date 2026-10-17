import {
  API_ERROR_CODES,
  type MountainResponse,
  MountainSlugParamSchema,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { HttpError, defineHandler } from './_shared/handler.ts';
import { getMountain } from './_shared/harimQueries.ts';

/**
 * GET /api/mountains/:slug → the full record: alternatives with their sources, parent and
 * summits, local names, name origin, prominence, isolation and every source.
 */
export default defineHandler(async (_request, context): Promise<MountainResponse> => {
  const raw = (context.params.slug ?? '').slice(0, 120);
  const parsed = MountainSlugParamSchema.safeParse(raw);
  const mountain = parsed.success ? await getMountain(getDb(), parsed.data) : null;
  if (!mountain) {
    throw new HttpError(API_ERROR_CODES.notFound, raw ? `No mountain ${raw}` : 'No such mountain');
  }
  return { mountain };
});

// The other /api/mountains/* routes are separate functions.
export const config: Config = {
  path: '/api/mountains/:slug',
  excludedPath: [
    '/api/mountains/summary',
    '/api/mountains/stats',
    '/api/mountains/export',
    '/api/mountains/ranges',
  ],
};
