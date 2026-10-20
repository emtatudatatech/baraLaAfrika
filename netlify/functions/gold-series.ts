import { type GoldSeriesResponse, GoldSeriesQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { goldSeries } from './_shared/goldCharts.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';

/**
 * GET /api/gold/series?metric=production|exports|imports|holdings_tonnes|holdings_usd
 *   &countries=iso3,iso3&region=&from=&to=&granularity=year|month
 * → one series per country (production adds Africa's or the region's yearly totals with their
 * completeness). Pre-aggregated in SQL and capped at GOLD_SERIES_MAX_POINTS points.
 */
export default defineHandler(async (request): Promise<GoldSeriesResponse> => {
  const query = GoldSeriesQuerySchema.parse(queryParams(request));
  return goldSeries(getDb(), query);
});

export const config: Config = { path: '/api/gold/series' };
