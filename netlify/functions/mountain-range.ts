import {
  API_ERROR_CODES,
  MountainSlugParamSchema,
  type RangeResponse,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { HttpError, defineHandler } from './_shared/handler.ts';
import { getRange } from './_shared/harimQueries.ts';

/** GET /api/mountains/ranges/:slug → one range: its text, source and mountains. */
export default defineHandler(async (_request, context): Promise<RangeResponse> => {
  const parsed = MountainSlugParamSchema.safeParse(context.params.slug);
  const range = parsed.success ? await getRange(getDb(), parsed.data) : null;
  if (!range) throw new HttpError(API_ERROR_CODES.notFound, 'No such range');
  return { range };
});

export const config: Config = { path: '/api/mountains/ranges/:slug' };
