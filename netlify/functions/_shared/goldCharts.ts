import type {
  GoldCountryDetail,
  GoldHoldingsChange,
  GoldHoldingsChangeQuery,
  GoldSeries,
  GoldSeriesQuery,
  GoldSeriesResponse,
  GoldTradeFigure,
  RegionSlug,
} from './contract.ts';

import { GOLD_SERIES_MAX_POINTS } from './contract.ts';
import type { Db } from './db.ts';
import { listGoldCountries } from './goldQueries.ts';

/*
 * Dhahabu chart series, the price-versus-volume split and one country's drawer (migrations
 * 0007–0009). Aggregation happens in SQL; this layer only shapes rows.
 */

interface SeriesRow {
  iso3: string;
  name: string;
  region: RegionSlug;
  period: string;
  value: string | null;
  basis: string | null;
  value_usd: string | null;
}

const num = (value: string | null): number | null => (value === null ? null : Number(value));

/**
 * One series per country for a metric over a year range. Production and trade are annual
 * (`period` = `2021`); holdings are monthly (`2021-09`), or each year's last report with
 * `granularity=year`. More than GOLD_SERIES_MAX_POINTS points are cut from the earliest periods.
 */
export async function goldSeries(db: Db, query: GoldSeriesQuery): Promise<GoldSeriesResponse> {
  const params = [
    query.countries ?? null,
    query.region ?? null,
    query.from ?? null,
    query.to ?? null,
  ];
  const scope = `($1::text[] IS NULL OR c.iso3 = ANY ($1::text[]))
    AND ($2::text IS NULL OR g.slug = $2)`;
  let rows: SeriesRow[];
  switch (query.metric) {
    case 'production':
      rows = await db.query<SeriesRow>(
        `SELECT c.iso3, c.name, g.slug AS region, p.year::text AS period, p.tonnes::text AS value,
                p.basis::text AS basis, round(p.value_usd)::text AS value_usd
         FROM v_gold_production p
         JOIN countries c ON c.id = p.country_id JOIN regions g ON g.id = c.region_id
         WHERE ${scope}
           AND ($3::int IS NULL OR p.year >= $3) AND ($4::int IS NULL OR p.year <= $4)
         ORDER BY c.name, p.year`,
        params,
      );
      break;
    case 'exports':
    case 'imports':
      // The country's own report, or its partners' (mirror) when it has none; `basis` says which.
      rows = await db.query<SeriesRow>(
        `SELECT DISTINCT ON (c.name, t.year) c.iso3, c.name, g.slug AS region,
                t.year::text AS period, round(t.value_usd)::text AS value, t.basis::text AS basis,
                NULL::text AS value_usd
         FROM gold_trade_annual t
         JOIN countries c ON c.id = t.country_id JOIN regions g ON g.id = c.region_id
         WHERE ${scope} AND t.flow = $5::gold_trade_flow
           AND ($3::int IS NULL OR t.year >= $3) AND ($4::int IS NULL OR t.year <= $4)
         ORDER BY c.name, t.year, t.basis <> 'reported'`,
        [...params, query.metric === 'exports' ? 'export' : 'import'],
      );
      break;
    case 'holdings_tonnes':
    case 'holdings_usd': {
      const column = query.metric === 'holdings_tonnes' ? 'r.tonnes' : 'round(r.value_usd)';
      rows = await db.query<SeriesRow>(
        `SELECT ${query.granularity === 'year' ? 'DISTINCT ON (c.name, extract(year FROM r.as_of))' : ''}
                c.iso3, c.name, g.slug AS region, to_char(r.as_of, 'YYYY-MM') AS period,
                ${column}::text AS value, r.valuation::text AS basis, NULL::text AS value_usd
         FROM gold_official_reserves r
         JOIN countries c ON c.id = r.country_id JOIN regions g ON g.id = c.region_id
         WHERE ${scope}
           AND ($3::int IS NULL OR r.as_of >= make_date($3, 1, 1))
           AND ($4::int IS NULL OR r.as_of <= make_date($4, 12, 31))
         ORDER BY c.name, ${query.granularity === 'year' ? 'extract(year FROM r.as_of), r.as_of DESC' : 'r.as_of'}`,
        params,
      );
      break;
    }
  }

  // The cap: drop whole periods, earliest first, so every series keeps the same span.
  let capped = false;
  if (rows.length > GOLD_SERIES_MAX_POINTS) {
    capped = true;
    const perPeriod = new Map<string, number>();
    for (const row of rows) perPeriod.set(row.period, (perPeriod.get(row.period) ?? 0) + 1);
    let total = rows.length;
    const dropped = new Set<string>();
    for (const period of [...perPeriod.keys()].sort()) {
      if (total <= GOLD_SERIES_MAX_POINTS) break;
      dropped.add(period);
      total -= perPeriod.get(period) ?? 0;
    }
    rows = rows.filter((row) => !dropped.has(row.period));
  }

  const series = new Map<string, GoldSeries>();
  for (const row of rows) {
    let entry = series.get(row.iso3);
    if (!entry) {
      entry = { country: { iso3: row.iso3, name: row.name, region: row.region }, points: [] };
      series.set(row.iso3, entry);
    }
    entry.points.push({
      period: row.period,
      value: num(row.value),
      basis: row.basis,
      valueUsd: num(row.value_usd),
    });
  }

  const totals =
    query.metric === 'production' && query.countries === undefined
      ? await productionTotals(db, query.region, query.from, query.to)
      : null;

  return {
    metric: query.metric,
    unit: query.metric === 'production' || query.metric === 'holdings_tonnes' ? 't' : 'USD',
    granularity: query.metric.startsWith('holdings_') ? query.granularity : 'year',
    series: [...series.values()],
    totals,
    capped,
  };
}

async function productionTotals(
  db: Db,
  region: RegionSlug | undefined,
  from: number | undefined,
  to: number | undefined,
): Promise<NonNullable<GoldSeriesResponse['totals']>> {
  const rows = await db.query<{
    year: number;
    tonnes: string;
    countries: number;
    missing_tonnes: string;
    missing_countries: number;
    is_complete: boolean;
  }>(
    `SELECT year, tonnes::text, countries, missing_tonnes::text, missing_countries, is_complete
     FROM gold_production_years($1::text)
     WHERE ($2::int IS NULL OR year >= $2) AND ($3::int IS NULL OR year <= $3)
     ORDER BY year`,
    [region ?? null, from ?? null, to ?? null],
  );
  return rows.map((row) => ({
    year: row.year,
    tonnes: Number(row.tonnes),
    countries: row.countries,
    missingTonnes: Number(row.missing_tonnes),
    missingCountries: row.missing_countries,
    complete: row.is_complete,
  }));
}

/** Each country's change in holdings over the years, split into price and volume effects. */
export async function goldHoldingsChange(
  db: Db,
  query: GoldHoldingsChangeQuery,
): Promise<GoldHoldingsChange[]> {
  const rows = await db.query<{
    iso3: string;
    name: string;
    from_month: string;
    to_month: string;
    tonnes_from: string;
    tonnes_to: string;
    price_from: string | null;
    price_to: string | null;
    value_from: string;
    value_to: string;
    change_usd: string;
    price_effect_usd: string | null;
    volume_effect_usd: string | null;
  }>(
    `SELECT iso3, name, from_month::text, to_month::text, tonnes_from::text, tonnes_to::text,
            price_from::text, price_to::text, value_from::text, value_to::text,
            change_usd::text, price_effect_usd::text, volume_effect_usd::text
     FROM gold_holdings_change(
       $1::text[],
       CASE WHEN $2::int IS NULL THEN NULL ELSE make_date($2, 1, 1) END,
       CASE WHEN $3::int IS NULL THEN NULL ELSE make_date($3, 12, 31) END)`,
    [query.countries ?? null, query.from ?? null, query.to ?? null],
  );
  return rows.map((row) => ({
    country: { iso3: row.iso3, name: row.name },
    fromMonth: row.from_month,
    toMonth: row.to_month,
    tonnesFrom: Number(row.tonnes_from),
    tonnesTo: Number(row.tonnes_to),
    priceFrom: num(row.price_from),
    priceTo: num(row.price_to),
    valueFromUsd: Number(row.value_from),
    valueToUsd: Number(row.value_to),
    changeUsd: Number(row.change_usd),
    priceEffectUsd: num(row.price_effect_usd),
    volumeEffectUsd: num(row.volume_effect_usd),
  }));
}

type SourceLink = GoldCountryDetail['sources'][number];

interface SourceRow {
  title: string;
  url: string;
  tier: SourceLink['reliabilityTier'];
  used_for: string;
}

/** Everything the country drawer shows; null for a country that does not exist. */
export async function getGoldCountry(
  db: Db,
  iso3: string,
  year: number | undefined,
): Promise<GoldCountryDetail | null> {
  const [row] = await listGoldCountries(db, { iso3, year, sort: 'name' });
  if (!row) return null;
  const params = [iso3];
  const country = `(SELECT id FROM countries WHERE iso3 = $1)`;

  const [production, trade, partners, holdings, inground, price, notes, artisanal, sources] =
    await Promise.all([
      db.query<{
        year: number;
        tonnes: string | null;
        basis: GoldCountryDetail['production'][number]['basis'];
        value_usd: string | null;
        price: string | null;
        source: string;
        notes: string | null;
      }>(
        `SELECT p.year, p.tonnes::text, p.basis::text AS basis, round(p.value_usd)::text AS value_usd,
                round(p.price_usd_per_troy_oz, 2)::text AS price, s.title AS source, p.notes
         FROM v_gold_production p JOIN sources s ON s.id = p.source_id
         WHERE p.country_id = ${country} ORDER BY p.year`,
        params,
      ),
      db.query<{
        year: number;
        flow: 'export' | 'import';
        basis: 'reported' | 'mirror';
        value_usd: string;
        net_weight_kg: string | null;
        partner_count: number | null;
        notes: string | null;
      }>(
        `SELECT year, flow::text AS flow, basis::text AS basis, round(value_usd)::text AS value_usd,
                net_weight_kg::text, partner_count, notes
         FROM gold_trade_annual WHERE country_id = ${country} ORDER BY year`,
        params,
      ),
      db.query<{
        year: number;
        basis: 'reported' | 'mirror';
        rank: number;
        partner_name: string;
        partner_iso3: string | null;
        value_usd: string;
        net_weight_kg: string | null;
      }>(
        `SELECT year, basis::text AS basis, rank, partner_name, partner_iso3,
                round(value_usd)::text AS value_usd, net_weight_kg::text
         FROM gold_trade_partners
         WHERE country_id = ${country} AND flow = 'export'
           AND year = (SELECT max(year) FROM gold_trade_partners
                       WHERE country_id = ${country} AND flow = 'export')
         ORDER BY basis, rank`,
        params,
      ),
      db.query<{ as_of: string; tonnes: string; value_usd: string; pct: string | null }>(
        `SELECT DISTINCT ON (extract(year FROM as_of)) as_of::text, tonnes::text,
                round(value_usd)::text AS value_usd, pct_of_total_reserves::text AS pct
         FROM gold_official_reserves WHERE country_id = ${country}
         ORDER BY extract(year FROM as_of), as_of DESC`,
        params,
      ),
      db.query<{ year: number; tonnes: string; definition: string; source: string }>(
        `SELECT r.year, r.tonnes_contained::text AS tonnes, r.definition, s.title AS source
         FROM gold_inground_reserves r JOIN sources s ON s.id = r.source_id
         WHERE r.country_id = ${country} ORDER BY r.year DESC, s.title`,
        params,
      ),
      db.query<{ month: string; usd: string }>(
        `SELECT month::text, usd_per_troy_oz::text AS usd FROM gold_price_monthly
         ORDER BY month DESC LIMIT 1`,
      ),
      db.query<{
        note: string;
        as_of: string;
        title: string;
        url: string;
        tier: SourceLink['reliabilityTier'];
        needs_review: boolean;
        review_notes: string | null;
      }>(
        `SELECT n.note, n.as_of::text, s.title, s.url, s.reliability_tier::text AS tier,
                n.needs_review, n.review_notes
         FROM gold_profile_notes n JOIN sources s ON s.id = n.source_id
         WHERE n.country_id = ${country} ORDER BY n.sort_order`,
        params,
      ),
      db.query<{ title: string; url: string; tier: SourceLink['reliabilityTier'] }>(
        `SELECT s.title, s.url, s.reliability_tier::text AS tier
         FROM country_gold_profiles p JOIN sources s ON s.id = p.asm_source_id
         WHERE p.country_id = ${country}`,
        params,
      ),
      // Every source behind the drawer, with what it supports (in the drawer's order).
      db.query<SourceRow>(
        `WITH used AS (
           SELECT presence_source_id AS id, 'presence' AS used_for, 1 AS ord
             FROM country_gold_profiles WHERE country_id = ${country}
           UNION SELECT asm_source_id, 'artisanal', 2
             FROM country_gold_profiles WHERE country_id = ${country}
           UNION SELECT source_id, 'production', 3
             FROM gold_production_annual WHERE country_id = ${country}
           UNION SELECT source_id, 'trade', 4 FROM gold_trade_annual WHERE country_id = ${country}
           UNION SELECT source_id, 'holdings', 5
             FROM gold_official_reserves WHERE country_id = ${country}
           UNION SELECT source_id, 'inground', 6
             FROM gold_inground_reserves WHERE country_id = ${country}
           UNION SELECT source_id, 'notes', 7 FROM gold_profile_notes WHERE country_id = ${country}
         )
         SELECT s.title, s.url, s.reliability_tier::text AS tier,
                string_agg(u.used_for, ',' ORDER BY u.ord) AS used_for
         FROM used u JOIN sources s ON s.id = u.id
         GROUP BY s.id, s.title, s.url, s.reliability_tier
         ORDER BY min(u.ord), s.title`,
        params,
      ),
    ]);

  const figure = (r: (typeof trade)[number]): GoldTradeFigure => ({
    year: r.year,
    valueUsd: Number(r.value_usd),
    netWeightKg: num(r.net_weight_kg),
    partnerCount: r.partner_count,
    notes: r.notes,
  });
  const tradeByYear = new Map<number, GoldCountryDetail['trade'][number]>();
  for (const r of trade) {
    const entry = tradeByYear.get(r.year) ?? {
      year: r.year,
      exportsReported: null,
      exportsMirror: null,
      importsReported: null,
      importsMirror: null,
    };
    const key =
      `${r.flow === 'export' ? 'exports' : 'imports'}${r.basis === 'reported' ? 'Reported' : 'Mirror'}` as const;
    entry[key] = figure(r);
    tradeByYear.set(r.year, entry);
  }

  const partner = (p: (typeof partners)[number]) => ({
    rank: p.rank,
    name: p.partner_name,
    iso3: p.partner_iso3,
    valueUsd: Number(p.value_usd),
    netWeightKg: num(p.net_weight_kg),
  });
  const [latestPrice] = price;
  const [asm] = artisanal;

  return {
    row,
    artisanalSource: asm ? { title: asm.title, url: asm.url, reliabilityTier: asm.tier } : null,
    production: production.map((p) => ({
      year: p.year,
      tonnes: num(p.tonnes),
      basis: p.basis,
      valueUsd: num(p.value_usd),
      priceUsdPerOz: num(p.price),
      source: p.source,
      notes: p.notes,
    })),
    trade: [...tradeByYear.values()],
    partners:
      partners.length === 0
        ? null
        : {
            year: partners[0]?.year ?? 0,
            reported: partners.filter((p) => p.basis === 'reported').map(partner),
            mirror: partners.filter((p) => p.basis === 'mirror').map(partner),
          },
    holdings: holdings.map((h) => ({
      asOf: h.as_of,
      tonnes: Number(h.tonnes),
      valueUsd: Number(h.value_usd),
      pctOfReserves: num(h.pct),
    })),
    inground: inground.map((r) => ({
      year: r.year,
      tonnes: Number(r.tonnes),
      definition: r.definition,
      source: r.source,
    })),
    latestPrice: latestPrice
      ? { month: latestPrice.month, usdPerOz: Number(latestPrice.usd) }
      : null,
    notes: notes.map((n) => ({
      note: n.note,
      asOf: n.as_of,
      source: { title: n.title, url: n.url, reliabilityTier: n.tier },
      needsReview: n.needs_review,
      reviewNotes: n.review_notes,
    })),
    sources: sources.map((s) => ({
      title: s.title,
      url: s.url,
      reliabilityTier: s.tier,
      usedFor: s.used_for.split(','),
    })),
  };
}
