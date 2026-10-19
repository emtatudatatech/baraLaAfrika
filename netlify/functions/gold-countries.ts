import { type GoldCountriesResponse, GoldCountriesQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { listGoldCountries } from './_shared/goldQueries.ts';

/**
 * GET /api/gold/countries?region=&q=&presence=&year=&sort= → one row per country with its
 * presence tier and its latest figure per metric in or before `year` (latest available without
 * it). Every figure carries its own year or date; null means no data.
 */
export default defineHandler(async (request): Promise<GoldCountriesResponse> => {
  const query = GoldCountriesQuerySchema.parse(queryParams(request));
  const countries = await listGoldCountries(getDb(), query);
  return { year: query.year ?? null, countries };
});

export const config: Config = { path: '/api/gold/countries' };
