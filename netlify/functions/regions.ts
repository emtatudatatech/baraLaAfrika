import type { RegionsResponse } from './_shared/contract';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db';
import { defineHandler } from './_shared/handler';
import { listRegions } from './_shared/queries';

/** GET /api/regions → the five regions with their approved colours and country counts. */
export default defineHandler(async (): Promise<RegionsResponse> => {
  return { regions: await listRegions(getDb()) };
});

export const config: Config = { path: '/api/regions' };
