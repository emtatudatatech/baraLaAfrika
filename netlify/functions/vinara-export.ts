import { REGION_NAMES, VinaraExportQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { fileResponse } from './_shared/http.ts';
import { buildVinaraCsv } from './_shared/vinaraExport.ts';
import { getVinaraExportRows, vinaraDatasets, vinaraDefinitions } from './_shared/vinaraQueries.ts';

/**
 * GET /api/vinara/export?format=csv&region=&from=&to= → every measure's ranking for Africa or a
 * region as CSV, with the as-of date, years, notes, definitions and required attributions.
 */
export default defineHandler(async (request) => {
  const query = VinaraExportQuerySchema.parse(queryParams(request));
  const db = getDb();
  const [rows, definitions, datasets] = await Promise.all([
    getVinaraExportRows(db, query.region, query.from, query.to),
    vinaraDefinitions(db),
    vinaraDatasets(db),
  ]);
  const file = buildVinaraCsv({
    rows,
    definitions,
    query,
    regionName: query.region === undefined ? null : REGION_NAMES[query.region],
    datasets,
    origin: new URL(request.url).origin,
    generatedAt: new Date().toISOString(),
  });
  return fileResponse(request, file.body, {
    contentType: 'text/csv; charset=utf-8',
    filename: file.filename,
  });
});

export const config: Config = { path: '/api/vinara/export' };
