import { MountainsExportQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { buildCsv, buildGeoJson } from './_shared/harimExport.ts';
import { elevationSources, listMountains, mountainDatasets } from './_shared/harimQueries.ts';
import { fileResponse } from './_shared/http.ts';

/**
 * GET /api/mountains/export?format=csv|geojson&<the /api/mountains filters> → a download of the
 * filtered view (or the whole catalogue without filters), with as-of dates, dataset versions,
 * licences and attributions.
 */
export default defineHandler(async (request) => {
  const query = MountainsExportQuerySchema.parse(queryParams(request));
  const db = getDb();
  const [{ mountains }, datasets, countries] = await Promise.all([
    listMountains(db, query, null),
    mountainDatasets(db),
    db.query<{ iso3: string; name: string }>('SELECT iso3, name FROM countries'),
  ]);
  const context = {
    mountains,
    query,
    datasets,
    heightSources: await elevationSources(
      db,
      mountains.map((m) => m.slug),
    ),
    countryNames: new Map(countries.map((c) => [c.iso3, c.name])),
    origin: new URL(request.url).origin,
    generatedAt: new Date().toISOString(),
  };
  const file = query.format === 'geojson' ? buildGeoJson(context) : buildCsv(context);
  return fileResponse(request, file.body, {
    contentType:
      query.format === 'geojson'
        ? 'application/geo+json; charset=utf-8'
        : 'text/csv; charset=utf-8',
    filename: file.filename,
  });
});

export const config: Config = { path: '/api/mountains/export' };
