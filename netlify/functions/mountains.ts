import { type MountainsResponse, MountainsQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { MOUNTAIN_LIST_CAP, listMountains } from './_shared/harimQueries.ts';

/**
 * GET /api/mountains?region=&country=&range=&q=&minHeight=&volcanic=&sort=&territories=&summits=
 * → catalogue mountains (massifs once, no summits or territory peaks unless asked), sorted with a
 * stable tie-break (default: height, highest first; prominence puts unknown values last).
 */
export default defineHandler(async (request): Promise<MountainsResponse> => {
  const query = MountainsQuerySchema.parse(queryParams(request));
  const { mountains, total } = await listMountains(getDb(), query);
  return { mountains, count: mountains.length, total, capped: total > MOUNTAIN_LIST_CAP };
});

export const config: Config = { path: '/api/mountains' };
