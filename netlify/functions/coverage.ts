import { type CoverageResponse, CoverageQuerySchema } from './_shared/contract';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db';
import { defineHandler, queryParams } from './_shared/handler';
import { listDatasets } from './_shared/queries';

/** GET /api/coverage?datasets=a,b → coverage and "as of" information for the data ribbon. */
export default defineHandler(async (request): Promise<CoverageResponse> => {
  const { datasets: keys } = CoverageQuerySchema.parse(queryParams(request));
  const datasets = await listDatasets(getDb(), keys);
  const found = new Set(datasets.map((d) => d.key));
  return { datasets, missing: (keys ?? []).filter((key) => !found.has(key)) };
});

export const config: Config = { path: '/api/coverage' };
