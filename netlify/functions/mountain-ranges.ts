import { type RangesResponse, RangesQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { listRanges } from './_shared/harimQueries.ts';

/** GET /api/mountains/ranges?region=&q= → the ranges with catalogued mountains, tallest first. */
export default defineHandler(async (request): Promise<RangesResponse> => {
  const query = RangesQuerySchema.parse(queryParams(request));
  const ranges = await listRanges(getDb(), query);
  return { ranges, count: ranges.length };
});

export const config: Config = { path: '/api/mountains/ranges' };
