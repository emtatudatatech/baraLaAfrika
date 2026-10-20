import {
  API_ERROR_CODES,
  type GoldCountryResponse,
  GoldCountryQuerySchema,
  Iso3ParamSchema,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { getGoldCountry } from './_shared/goldCharts.ts';
import { HttpError, defineHandler, queryParams } from './_shared/handler.ts';

/**
 * GET /api/gold/countries/:iso3?year= → one country's drawer: its table row at the reference
 * year, production, trade (reported and mirror, top partners), central bank holdings by year,
 * in-ground reserves (a different thing), curated notes and every source with what it supports.
 */
export default defineHandler(async (request, context): Promise<GoldCountryResponse> => {
  const query = GoldCountryQuerySchema.parse(queryParams(request));
  // A malformed code names a country that does not exist (404), like an unknown one.
  const raw = (context.params.iso3 ?? '').slice(0, 16);
  const parsed = Iso3ParamSchema.safeParse(raw);
  const country = parsed.success ? await getGoldCountry(getDb(), parsed.data, query.year) : null;
  if (!country) {
    const message = raw ? `No country with code ${raw.toUpperCase()}` : 'No such country';
    throw new HttpError(API_ERROR_CODES.notFound, message);
  }
  return { year: query.year ?? null, country };
});

export const config: Config = { path: '/api/gold/countries/:iso3' };
