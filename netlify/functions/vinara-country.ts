import {
  API_ERROR_CODES,
  type VinaraCountryResponse,
  VinaraQuerySchema,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { HttpError, defineHandler, queryParams } from './_shared/handler.ts';
import { getVinaraCountry } from './_shared/vinaraQueries.ts';

/**
 * GET /api/vinara/countries/:iso3?from=&to= → one state's figure and rank (in Africa and its
 * region) on each measure over the page's years, context figures, public external debt by
 * creditor and its currency (the country drawer on /vinara).
 */
export default defineHandler(async (request, context): Promise<VinaraCountryResponse> => {
  const iso3 = context.params.iso3 ?? '';
  if (!/^[A-Z]{3}$/.test(iso3)) throw new HttpError(API_ERROR_CODES.notFound, 'No such country');
  const { from, to } = VinaraQuerySchema.parse(queryParams(request));
  const result = await getVinaraCountry(getDb(), iso3, from, to);
  if (result === null) throw new HttpError(API_ERROR_CODES.notFound, 'No such country');
  return result;
});

export const config: Config = { path: '/api/vinara/countries/:iso3' };
