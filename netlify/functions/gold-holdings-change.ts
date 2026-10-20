import {
  type GoldHoldingsChangeResponse,
  GoldHoldingsChangeQuerySchema,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { goldHoldingsChange } from './_shared/goldCharts.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';

/**
 * GET /api/gold/holdings-change?countries=iso3,iso3&from=&to= → for each country with two or
 * more monthly reports in the years given, the change in the US dollar value of its central bank
 * gold between its first and last report, split into a price effect and a volume effect that sum
 * exactly to the change (gold_holdings_change, migration 0009).
 */
export default defineHandler(async (request): Promise<GoldHoldingsChangeResponse> => {
  const query = GoldHoldingsChangeQuerySchema.parse(queryParams(request));
  return { changes: await goldHoldingsChange(getDb(), query) };
});

export const config: Config = { path: '/api/gold/holdings-change' };
