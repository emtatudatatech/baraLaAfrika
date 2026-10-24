/*
 * Every API function with its route, read from the function's own `config` (path and
 * excludedPath), so local servers and tests route exactly as Netlify does. Add new functions here.
 */
import type { Config, Context } from '@netlify/functions';

import * as countries from '../functions/countries.ts';
import * as country from '../functions/country.ts';
import * as coverage from '../functions/coverage.ts';
import * as goldCountries from '../functions/gold-countries.ts';
import * as goldCountry from '../functions/gold-country.ts';
import * as goldExport from '../functions/gold-export.ts';
import * as goldHoldingsChange from '../functions/gold-holdings-change.ts';
import * as goldPrice from '../functions/gold-price.ts';
import * as goldSeries from '../functions/gold-series.ts';
import * as goldStats from '../functions/gold-stats.ts';
import * as mountain from '../functions/mountain.ts';
import * as mountainRange from '../functions/mountain-range.ts';
import * as mountainRanges from '../functions/mountain-ranges.ts';
import * as mountains from '../functions/mountains.ts';
import * as mountainsExport from '../functions/mountains-export.ts';
import * as mountainsStats from '../functions/mountains-stats.ts';
import * as mountainsSummary from '../functions/mountains-summary.ts';
import * as regions from '../functions/regions.ts';
import * as vinara from '../functions/vinara.ts';
import * as vinaraCountry from '../functions/vinara-country.ts';
import * as vinaraExport from '../functions/vinara-export.ts';
import * as vinaraMetric from '../functions/vinara-metric.ts';

type Handler = (request: Request, context: Context) => Promise<Response>;

interface FunctionModule {
  default: Handler;
  config: Config;
}

export const FUNCTIONS: Record<string, FunctionModule> = {
  countries,
  country,
  coverage,
  'gold-countries': goldCountries,
  'gold-country': goldCountry,
  'gold-export': goldExport,
  'gold-holdings-change': goldHoldingsChange,
  'gold-price': goldPrice,
  'gold-series': goldSeries,
  'gold-stats': goldStats,
  mountain,
  'mountain-range': mountainRange,
  'mountain-ranges': mountainRanges,
  mountains,
  'mountains-export': mountainsExport,
  'mountains-stats': mountainsStats,
  'mountains-summary': mountainsSummary,
  regions,
  vinara,
  'vinara-country': vinaraCountry,
  'vinara-export': vinaraExport,
  'vinara-metric': vinaraMetric,
};

const asList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** The functions whose path matches `pathname` and does not exclude it. */
export function matchingFunctions(
  pathname: string,
): { name: string; handler: Handler; params: Record<string, string> }[] {
  const matches = [];
  for (const [name, module] of Object.entries(FUNCTIONS)) {
    const excluded = asList(module.config.excludedPath).some((path) =>
      new URLPattern({ pathname: path }).test({ pathname }),
    );
    if (excluded) continue;
    for (const path of asList(module.config.path)) {
      const match = new URLPattern({ pathname: path }).exec({ pathname });
      if (match) {
        matches.push({
          name,
          handler: module.default,
          params: match.pathname.groups as Record<string, string>,
        });
        break;
      }
    }
  }
  return matches;
}
