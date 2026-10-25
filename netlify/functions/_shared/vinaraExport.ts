import type { VinaraExportQuery } from './contract.ts';

import { csvCell } from './harimExport.ts';
import type { DatasetMeta } from './harimQueries.ts';
import type { VinaraExportRow } from './vinaraQueries.ts';

/*
 * /api/vinara/export: every measure's ranking for the scope and years as CSV. A block of "#"
 * lines comes first (as-of date, scope, years, the rules that keep the numbers honest, each
 * measure's definition, and the sources with their licences and required attributions), then
 * one row per measure and state: ranked states first, then those taking no part, with why.
 */

export interface VinaraExportContext {
  rows: readonly VinaraExportRow[];
  definitions: readonly { key: string; definition: string }[];
  query: VinaraExportQuery;
  regionName: string | null;
  datasets: readonly DatasetMeta[];
  origin: string;
  generatedAt: string;
}

const NOTES = [
  'Each measure is ranked over its own years (window_from to window_to): by default its last ten complete years (a year is complete when at least 90% of the states have a figure; the currency measures run to the latest full year of rates), or the years asked for, kept within the data.',
  "value is at the measure's precision. States with equal values at that precision share a rank (a tie), and every state in a tie is listed.",
  'year is the year the figure refers to; for a mean or a change over the window, its last year. imf_estimate = true: an IMF World Economic Outlook figure for the year before its latest edition.',
  'Empty rank and value: the state takes no part in that measure; not_ranked_reason says why. No data is never zero.',
  'Units: people; km2; current_usd (nominal US dollars); current_intl_usd (international dollars at purchasing power parity); percent; percent_of_gdp; index (0 to 1).',
  "Currency performance and stability use monthly averages: the mean of official daily rates where a state has them, otherwise the IMF's monthly average, with currency changes put on today's unit (a change is never a gain or a loss). Currencies are never compared by their exchange-rate level.",
  'Regions follow the UN M49 standard (Middle Africa is shown as Central Africa); the classification is cited, not republished.',
  'Descriptive only: not a forecast, and not investment advice.',
];

function newest(datasets: readonly DatasetMeta[]): string | null {
  return datasets.reduce<string | null>((a, d) => (a === null || d.asOf > a ? d.asOf : a), null);
}

function yearsLine(query: VinaraExportQuery): string {
  if (query.from === undefined && query.to === undefined) {
    return "each measure's default (its last ten complete years)";
  }
  return `${query.from === undefined ? 'default start' : String(query.from)} to ${
    query.to === undefined ? "each measure's latest complete year" : String(query.to)
  }, each measure kept within its data`;
}

function metadataLines(context: VinaraExportContext): string[] {
  const ranked = context.rows.filter((r) => r.rank !== null).length;
  return [
    'Bara La Afrika · Vinara: the cardinals of Africa',
    `Generated: ${context.generatedAt}`,
    `As of: ${newest(context.datasets) ?? 'unknown'}`,
    `Scope: ${context.regionName ?? 'Africa (54 states)'}`,
    `Years: ${yearsLine(context.query)}`,
    `Rows: ${String(context.rows.length)} (${String(ranked)} ranked)`,
    'Notes:',
    ...NOTES.map((note) => `  ${note}`),
    'Definitions:',
    ...context.definitions.map((d) => `  ${d.key}: ${d.definition}`),
    'Datasets and required attributions:',
    ...context.datasets.map(
      (d) =>
        `  ${d.name} (as of ${d.asOf}); provider: ${d.provider}; licence: ${d.license}; attribution: ${d.attribution}`,
    ),
    `Source: Bara La Afrika (${context.origin}/vinara).`,
  ];
}

const HEADER = [
  'metric',
  'metric_name',
  'unit',
  'window_from',
  'window_to',
  'rank',
  'iso3',
  'country',
  'region',
  'value',
  'year',
  'imf_estimate',
  'not_ranked_reason',
] as const;

function record(
  row: VinaraExportRow,
): Record<(typeof HEADER)[number], string | number | boolean | null> {
  return {
    metric: row.metric,
    metric_name: row.metricName,
    unit: row.unit,
    window_from: row.from,
    window_to: row.to,
    rank: row.rank,
    iso3: row.iso3,
    country: row.country,
    region: row.region,
    value: row.value,
    year: row.year,
    imf_estimate: row.rank === null ? null : row.estimate,
    not_ranked_reason: row.unrankedReason,
  };
}

export function buildVinaraCsv(context: VinaraExportContext): { body: string; filename: string } {
  const lines = [
    ...metadataLines(context).map((line) => `# ${line}`),
    HEADER.join(','),
    ...context.rows.map((row) => {
      const values = record(row);
      return HEADER.map((key) => csvCell(values[key])).join(',');
    }),
  ];
  const scope = context.query.region ?? 'africa';
  const years =
    context.query.from === undefined && context.query.to === undefined
      ? ''
      : `-${String(context.query.from ?? 'default')}-${String(context.query.to ?? 'latest')}`;
  const date = newest(context.datasets) ?? context.generatedAt.slice(0, 10);
  return { body: `${lines.join('\r\n')}\r\n`, filename: `vinara-${scope}${years}-${date}.csv` };
}
