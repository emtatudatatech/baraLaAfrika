import {
  API_ERROR_CODES,
  VinaraMetricKeySchema,
  type VinaraMetricResponse,
  VinaraQuerySchema,
} from './_shared/contract.ts';
import type { Config } from '@netlify/functions';

import { getDb } from './_shared/db.ts';
import { HttpError, defineHandler, queryParams } from './_shared/handler.ts';
import { getVinaraMetric } from './_shared/vinaraQueries.ts';

/**
 * GET /api/vinara/metrics/:key?region=&from=&to= → one metric's full ranking, its regional
 * figures (for Africa) and the cardinal's and contender's yearly values over the window.
 */
export default defineHandler(async (request, context): Promise<VinaraMetricResponse> => {
  const key = VinaraMetricKeySchema.safeParse(context.params.key ?? '');
  if (!key.success) {
    throw new HttpError(API_ERROR_CODES.notFound, 'No such Vinara metric');
  }
  const { region, from, to } = VinaraQuerySchema.parse(queryParams(request));
  const result = await getVinaraMetric(getDb(), key.data, region, from, to);
  if (result === null) {
    throw new HttpError(API_ERROR_CODES.unavailable, 'Indicator data is not loaded yet');
  }
  return result;
});

export const config: Config = { path: '/api/vinara/metrics/:key' };
