import { GoldExportQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { buildGoldCsv } from './_shared/goldExport.ts';
import { goldDatasets, listGoldCountries } from './_shared/goldQueries.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { fileResponse } from './_shared/http.ts';

/**
 * GET /api/gold/export?format=csv&<the /api/gold/countries filters> → the country table as CSV,
 * with the as-of date, reference year, sources, required attributions (the IMF's wording among
 * them) and the notes on nominal US dollars and computed values.
 */
export default defineHandler(async (request) => {
  const query = GoldExportQuerySchema.parse(queryParams(request));
  const db = getDb();
  const [countries, datasets] = await Promise.all([listGoldCountries(db, query), goldDatasets(db)]);
  const file = buildGoldCsv({
    countries,
    query,
    datasets,
    origin: new URL(request.url).origin,
    generatedAt: new Date().toISOString(),
  });
  return fileResponse(request, file.body, {
    contentType: 'text/csv; charset=utf-8',
    filename: file.filename,
  });
});

export const config: Config = { path: '/api/gold/export' };
