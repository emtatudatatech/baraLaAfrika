import { type CountriesResponse, CountriesQuerySchema } from './_shared/contract';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db';
import { defineHandler, queryParams } from './_shared/handler';
import { listCountries } from './_shared/queries';

/** GET /api/countries?region=<slug>&q=<search> → country summaries (all 54 without params). */
export default defineHandler(async (request): Promise<CountriesResponse> => {
  const { region, q } = CountriesQuerySchema.parse(queryParams(request));
  const countries = await listCountries(getDb(), { region, q });
  return { countries, count: countries.length };
});

export const config: Config = { path: '/api/countries' };
