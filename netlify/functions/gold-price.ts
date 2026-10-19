import { type GoldPriceResponse, GoldPriceQuerySchema } from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { defineHandler, queryParams } from './_shared/handler.ts';
import { goldPrice } from './_shared/goldQueries.ts';

/**
 * GET /api/gold/price?from=&to=&granularity=month|year → the gold price (the World Bank's
 * monthly average, nominal US dollars per troy ounce), or its annual means.
 */
export default defineHandler(async (request): Promise<GoldPriceResponse> => {
  const query = GoldPriceQuerySchema.parse(queryParams(request));
  return goldPrice(getDb(), query);
});

export const config: Config = { path: '/api/gold/price' };
