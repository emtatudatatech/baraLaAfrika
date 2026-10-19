import type { GoldCountry, GoldExportQuery } from './contract.ts';

import { csvCell } from './harimExport.ts';
import type { DatasetMeta } from './harimQueries.ts';

/*
 * /api/gold/export: the country table as CSV. A block of "#" lines comes first (as-of date,
 * reference year, filters, the sources with their licences and required attributions, and the
 * notes that keep the numbers honest), then one row per country. Empty cells mean no data;
 * zero is a reported zero; "included_in_other" production has no tonnes.
 */

export interface GoldExportContext {
  countries: readonly GoldCountry[];
  query: GoldExportQuery;
  datasets: readonly DatasetMeta[];
  origin: string;
  generatedAt: string;
}

const FILTER_KEYS = ['region', 'q', 'presence', 'year', 'sort'] as const;

export function goldFilters(query: GoldExportQuery): string[] {
  return FILTER_KEYS.flatMap((key) => {
    const value = query[key];
    if (value === undefined || (key === 'sort' && value === 'production')) return [];
    return [`${key}=${String(value)}`];
  });
}

const NOTES = [
  'Units: tonnes are metric tonnes of fine gold (1 tonne = 32,150.7466 troy ounces); money is nominal US dollars.',
  'Every figure has its own year or date column: countries report on different schedules. Without a reference year, each is the latest available.',
  'Empty cell = no data. 0 = a reported zero. production_basis "included_in_other" = the source lumps the country into "other countries" (no tonnes).',
  "production_value_usd is computed (tonnes x 32,150.7466 x that year's average monthly price), not reported. Central bank holdings are valued at their month's average price (computed).",
  'Gold trade is recorded trade in non-monetary gold (HS 7108 without 7108.20) reported to UN Comtrade. "Mirror" figures are what trading partners report; gaps between the two can reflect timing, valuation, classification, transit or unrecorded flows, and are not evidence of wrongdoing.',
  'Central bank holdings ("reserves" held by governments) and in-ground reserves (gold still in the ground) are different things; this file has central bank holdings only.',
  'Presence tiers rest on the sources consulted; "none_identified" means no significant gold deposits identified in the sources consulted, not that there is no gold.',
  "The price is the World Bank's monthly average, not a live price. Informational only; not financial advice.",
];

const IMF_STATEMENT =
  'Source: International Monetary Fund, International Liquidity (IL), https://data.imf.org/. Transformed by Bara La Afrika: fine troy ounces converted to tonnes; US dollar values computed from the World Bank monthly average gold price; share of reserves computed.';

function newest(datasets: readonly DatasetMeta[]): string | null {
  return datasets.reduce<string | null>((a, d) => (a === null || d.asOf > a ? d.asOf : a), null);
}

function metadataLines(context: GoldExportContext): string[] {
  const filters = goldFilters(context.query);
  return [
    'Bara La Afrika · Dhahabu: gold in Africa',
    `Generated: ${context.generatedAt}`,
    `As of: ${newest(context.datasets) ?? 'unknown'}`,
    `Reference year: ${context.query.year === undefined ? 'latest available per figure' : String(context.query.year)}`,
    `Rows: ${String(context.countries.length)}`,
    `Filters: ${filters.length > 0 ? filters.join(', ') : 'none (all 54 countries)'}`,
    'Notes:',
    ...NOTES.map((note) => `  ${note}`),
    'Datasets:',
    ...context.datasets.map(
      (d) =>
        `  ${d.name} (as of ${d.asOf}); provider: ${d.provider}; licence: ${d.license}; attribution: ${d.attribution}`,
    ),
    `Required attribution (IMF): ${IMF_STATEMENT}`,
    'Required attribution (World Bank): The World Bank: Commodity Price Data (The Pink Sheet), monthly prices: World Bank Prospects Group. CC BY 4.0.',
    'Required attribution (UN Comtrade): UN Comtrade, United Nations Statistics Division.',
    `Source: Bara La Afrika (${context.origin}/dhahabu).`,
  ];
}

function record(row: GoldCountry) {
  const p = row.production;
  const ex = row.exports;
  const im = row.imports;
  const h = row.holdings;
  return {
    iso3: row.country.iso3,
    country: row.country.name,
    region: row.country.region.name,
    presence_tier: row.presence.tier,
    presence_confidence: row.presence.confidence,
    presence_evidence: row.presence.basis,
    presence_source: row.presence.source?.url ?? null,
    production_year: p?.year ?? null,
    production_tonnes: p?.tonnes ?? null,
    production_basis: p?.basis ?? null,
    production_value_usd_computed: p?.valueUsd ?? null,
    production_price_usd_per_oz: p?.priceUsdPerOz ?? null,
    production_source: p?.source ?? null,
    exports_reported_year: ex.reported?.year ?? null,
    exports_reported_usd: ex.reported?.valueUsd ?? null,
    exports_reported_kg: ex.reported?.netWeightKg ?? null,
    exports_mirror_year: ex.mirror?.year ?? null,
    exports_mirror_usd: ex.mirror?.valueUsd ?? null,
    exports_mirror_kg: ex.mirror?.netWeightKg ?? null,
    imports_reported_year: im.reported?.year ?? null,
    imports_reported_usd: im.reported?.valueUsd ?? null,
    imports_mirror_year: im.mirror?.year ?? null,
    imports_mirror_usd: im.mirror?.valueUsd ?? null,
    holdings_as_of: h?.asOf ?? null,
    holdings_tonnes: h?.tonnes ?? null,
    holdings_value_usd_computed: h?.valueUsd ?? null,
    holdings_pct_of_reserves: h?.pctOfReserves ?? null,
    holdings_change_12m_tonnes: h?.change12mTonnes ?? null,
    holdings_reporting: row.reporting?.status ?? null,
    export_share_year: row.exportShare?.year ?? null,
    export_share_pct: row.exportShare?.pct ?? null,
  };
}

const HEADER = Object.keys(
  record({
    country: {
      iso3: '',
      iso2: '',
      name: '',
      region: { slug: 'north', name: '', colorHex: null },
      flag: { svgUrl: '', pngUrlTemplate: '', fallbackUrl: '' },
    },
    presence: {
      tier: 'unknown',
      basis: '',
      confidence: 'low',
      asOfYear: null,
      source: null,
      commercialMining: null,
      asmPresent: null,
      asmSharePct: null,
      summary: '',
      needsReview: false,
      reviewNotes: null,
    },
    production: null,
    exports: { reported: null, mirror: null },
    imports: { reported: null, mirror: null },
    holdings: null,
    reporting: null,
    exportShare: null,
  }),
);

export function buildGoldCsv(context: GoldExportContext): { body: string; filename: string } {
  const lines = [
    ...metadataLines(context).map((line) => `# ${line}`),
    HEADER.join(','),
    ...context.countries.map((row) => {
      const values = record(row);
      return HEADER.map((key) => csvCell(values[key as keyof typeof values])).join(',');
    }),
  ];
  const date = newest(context.datasets) ?? context.generatedAt.slice(0, 10);
  const scope = goldFilters(context.query).length > 0 ? 'countries-filtered' : 'countries';
  return { body: `${lines.join('\r\n')}\r\n`, filename: `dhahabu-${scope}-${date}.csv` };
}
