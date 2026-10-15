import { API_ERROR_CODES, type CountryResponse, Iso3ParamSchema } from './_shared/contract';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db';
import { HttpError, defineHandler } from './_shared/handler';
import { getCountry } from './_shared/queries';

/** GET /api/countries/:iso3 → full profile with details, sources and review status. */
export default defineHandler(async (_request, context): Promise<CountryResponse> => {
  // The path segment names a resource: a malformed code is a country that does not exist (404),
  // like an unknown one. (Query-string errors elsewhere are 400.)
  const raw = (context.params.iso3 ?? '').slice(0, 16);
  const parsed = Iso3ParamSchema.safeParse(raw);
  const country = parsed.success ? await getCountry(getDb(), parsed.data) : null;
  if (!country) {
    const message = raw ? `No country with code ${raw.toUpperCase()}` : 'No such country';
    throw new HttpError(API_ERROR_CODES.notFound, message);
  }
  return { country };
});

export const config: Config = { path: '/api/countries/:iso3' };
