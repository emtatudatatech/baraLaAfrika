import {
  API_ERROR_CODES,
  type GoldStatsResponse,
  GoldStatsQuerySchema,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { HttpError, defineHandler, queryParams } from './_shared/handler.ts';
import { getGoldStats } from './_shared/goldQueries.ts';

/**
 * GET /api/gold/stats?region=&year= → the Dhahabu summary cards for All Africa or one region at
 * a reference year (latest available without it), as computed by v_gold_stats (definitions and
 * tie rules: docs/dhahabu-stats.md).
 */
export default defineHandler(async (request): Promise<GoldStatsResponse> => {
  const { region, year } = GoldStatsQuerySchema.parse(queryParams(request));
  const stats = await getGoldStats(getDb(), region, year);
  if (stats === null) {
    throw new HttpError(API_ERROR_CODES.unavailable, 'Gold data is not loaded yet');
  }
  return { year: year ?? null, stats };
});

export const config: Config = { path: '/api/gold/stats' };
