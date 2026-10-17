import { type MountainSummaryResponse, MountainSummaryQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { listMountainSummary } from './_shared/harimQueries.ts';

/**
 * GET /api/mountains/summary?region=<slug>&q=<search> → one row per country (highest peak,
 * peak count, ranges, lowest point, relief), highest first. All 54 without params.
 */
export default defineHandler(async (request): Promise<MountainSummaryResponse> => {
  const filters = MountainSummaryQuerySchema.parse(queryParams(request));
  const countries = await listMountainSummary(getDb(), filters);
  return { countries, count: countries.length };
});

export const config: Config = { path: '/api/mountains/summary' };
