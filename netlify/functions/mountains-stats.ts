import {
  API_ERROR_CODES,
  type HarimStatsResponse,
  MountainStatsQuerySchema,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { HttpError, defineHandler, queryParams } from './_shared/handler.ts';
import { getHarimStats } from './_shared/harimQueries.ts';

/**
 * GET /api/mountains/stats?region=<slug> → the summary cards for All Africa or one region, as
 * computed by v_harim_stats (definitions and tie rules: docs/harim-stats.md).
 */
export default defineHandler(async (request): Promise<HarimStatsResponse> => {
  const { region } = MountainStatsQuerySchema.parse(queryParams(request));
  const stats = await getHarimStats(getDb(), region);
  if (stats === null) {
    throw new HttpError(API_ERROR_CODES.unavailable, 'Mountain data is not loaded yet');
  }
  return { stats };
});

export const config: Config = { path: '/api/mountains/stats' };
