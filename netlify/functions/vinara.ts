import { API_ERROR_CODES, type VinaraResponse, VinaraQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { HttpError, defineHandler, queryParams } from './_shared/handler.ts';
import { getVinara } from './_shared/vinaraQueries.ts';

/**
 * GET /api/vinara?region=&from=&to= → every metric's cardinal and silent contender for Africa
 * or one region, over each metric's default window or the years asked for, with the
 * gap-closing signal and (for Africa) the regions compared. Rules: docs/vinara-method.md.
 */
export default defineHandler(async (request): Promise<VinaraResponse> => {
  const { region, from, to } = VinaraQuerySchema.parse(queryParams(request));
  const result = await getVinara(getDb(), region, from, to);
  if (result === null) {
    throw new HttpError(API_ERROR_CODES.unavailable, 'Indicator data is not loaded yet');
  }
  return result;
});

export const config: Config = { path: '/api/vinara' };
