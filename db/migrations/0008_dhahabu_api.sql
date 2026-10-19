-- 0008_dhahabu_api.sql
-- What the Dhahabu API and statistics band read (milestone 15): world mine production (for
-- Africa's share), the IMF reporting status of each country, each country's latest figure per
-- metric up to a reference year (v_gold_country_latest / gold_country_metrics) and the summary
-- cards (v_gold_stats). Definitions and tie rules: docs/dhahabu-stats.md.
--
-- "Reference year": the end of the ribbon's year range. Every metric takes its latest value in
-- or before that year and carries its own year or date; NULL means "latest available".

-- ── World mine production ────────────────────────────────────────────────────

CREATE TABLE gold_world_production (
  year      smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  tonnes    numeric(12, 1) NOT NULL CHECK (tonnes > 0),
  basis     gold_production_basis NOT NULL CHECK (basis <> 'included_in_other'),
  source_id integer NOT NULL REFERENCES sources (id),
  PRIMARY KEY (year, source_id)
);

COMMENT ON TABLE gold_world_production IS
  'World gold mine production ("World total (rounded)") from each USGS Mineral Commodity Summaries edition.';
COMMENT ON COLUMN gold_world_production.year IS 'Calendar year.';
COMMENT ON COLUMN gold_world_production.tonnes IS 'World mine production, metric tonnes (rounded by the source).';
COMMENT ON COLUMN gold_world_production.basis IS 'reported, or estimate (the edition''s second year).';
COMMENT ON COLUMN gold_world_production.source_id IS 'The MCS edition.';

CREATE VIEW v_gold_world_production AS
SELECT DISTINCT ON (w.year) w.year, w.tonnes, w.basis, w.source_id
FROM gold_world_production w
LEFT JOIN gold_production_source_priority sp ON sp.source_id = w.source_id
ORDER BY w.year, w.basis <> 'reported', sp.priority NULLS LAST, w.source_id;

COMMENT ON VIEW v_gold_world_production IS
  'One world total per year: a reported figure over an estimate, then the newer edition.';
COMMENT ON COLUMN v_gold_world_production.year IS 'Calendar year.';
COMMENT ON COLUMN v_gold_world_production.tonnes IS 'World mine production, metric tonnes.';
COMMENT ON COLUMN v_gold_world_production.basis IS 'reported or estimate.';
COMMENT ON COLUMN v_gold_world_production.source_id IS 'The MCS edition used.';

-- ── Central bank reporting status ────────────────────────────────────────────

CREATE TYPE gold_reporting_status AS ENUM ('current', 'late', 'stale', 'pooled', 'none');
COMMENT ON TYPE gold_reporting_status IS
  'How a country reports gold holdings to the IMF: current (within 4 months of the newest report), late (within 2 years), stale (older), pooled (held by a regional central bank), none (no series).';

CREATE TABLE gold_reserves_reporting (
  country_id     smallint PRIMARY KEY REFERENCES countries (id) ON DELETE CASCADE,
  status         gold_reporting_status NOT NULL,
  first_month    date,
  last_month     date,
  months_behind  smallint CHECK (months_behind >= 0),
  gaps_in_window smallint NOT NULL DEFAULT 0 CHECK (gaps_in_window >= 0),
  note           text NOT NULL CHECK (btrim(note) <> ''),
  CHECK ((status IN ('pooled', 'none')) = (last_month IS NULL))
);

COMMENT ON TABLE gold_reserves_reporting IS
  'Each country''s reporting of gold holdings to the IMF, as of the last refresh (late and irregular reporters are shown, not hidden).';
COMMENT ON COLUMN gold_reserves_reporting.country_id IS 'The country.';
COMMENT ON COLUMN gold_reserves_reporting.status IS 'current, late, stale, pooled or none.';
COMMENT ON COLUMN gold_reserves_reporting.first_month IS 'First month with a reported holding.';
COMMENT ON COLUMN gold_reserves_reporting.last_month IS 'Latest month with a reported holding.';
COMMENT ON COLUMN gold_reserves_reporting.months_behind IS 'Months between the latest report and the newest report of any country.';
COMMENT ON COLUMN gold_reserves_reporting.gaps_in_window IS 'Missing months in the last 24 months of the series.';
COMMENT ON COLUMN gold_reserves_reporting.note IS 'A plain explanation, e.g. reserves pooled at the BCEAO.';

-- ── Each country's latest figures ────────────────────────────────────────────

CREATE FUNCTION gold_country_metrics(p_year integer DEFAULT NULL)
RETURNS TABLE (
  country_id smallint,
  production jsonb,
  exports_reported jsonb,
  exports_mirror jsonb,
  imports_reported jsonb,
  imports_mirror jsonb,
  holdings jsonb,
  export_share jsonb
)
LANGUAGE sql STABLE AS $$
WITH prod AS (
  -- The latest figure; "included in other" only when the country never has a figure.
  SELECT DISTINCT ON (p.country_id) p.country_id,
    jsonb_build_object(
      'year', p.year, 'tonnes', p.tonnes, 'basis', p.basis,
      'valueUsd', round(p.value_usd), 'priceUsdPerOz', round(p.price_usd_per_troy_oz, 2),
      'source', s.title, 'notes', p.notes) AS item
  FROM v_gold_production p JOIN sources s ON s.id = p.source_id
  WHERE p_year IS NULL OR p.year <= p_year
  ORDER BY p.country_id, p.tonnes IS NULL, p.year DESC
),
trade AS (
  SELECT DISTINCT ON (t.country_id, t.flow, t.basis) t.country_id, t.flow, t.basis,
    jsonb_build_object(
      'year', t.year, 'valueUsd', round(t.value_usd), 'netWeightKg', t.net_weight_kg,
      'partnerCount', t.partner_count, 'notes', t.notes) AS item
  FROM gold_trade_annual t
  WHERE p_year IS NULL OR t.year <= p_year
  ORDER BY t.country_id, t.flow, t.basis, t.year DESC
),
latest_holding AS (
  SELECT DISTINCT ON (r.country_id) r.*
  FROM gold_official_reserves r
  WHERE p_year IS NULL OR r.as_of <= make_date(p_year, 12, 31)
  ORDER BY r.country_id, r.as_of DESC
),
holding AS (
  SELECT h.country_id,
    jsonb_build_object(
      'asOf', h.as_of, 'tonnes', h.tonnes, 'valueUsd', round(h.value_usd),
      'pctOfReserves', h.pct_of_total_reserves, 'valuation', h.valuation,
      'change12mTonnes', h.tonnes - prev.tonnes,
      'change12mValueUsd', round(h.value_usd - prev.value_usd)) AS item
  FROM latest_holding h
  LEFT JOIN gold_official_reserves prev
    ON prev.country_id = h.country_id
   AND prev.as_of = (date_trunc('month', h.as_of) - interval '11 months' - interval '1 day')::date
),
share AS (
  -- Gold's share of merchandise exports: both parts from the same year, as reported.
  SELECT DISTINCT ON (t.country_id) t.country_id,
    jsonb_build_object(
      'year', t.year,
      'pct', CASE WHEN t.value_usd <= x.value_usd THEN round(100 * t.value_usd / x.value_usd, 2) END,
      'exceedsTotal', t.value_usd > x.value_usd,
      'goldUsd', round(t.value_usd), 'totalUsd', round(x.value_usd)) AS item
  FROM gold_trade_annual t
  JOIN country_total_exports_annual x ON x.country_id = t.country_id AND x.year = t.year
  WHERE t.flow = 'export' AND t.basis = 'reported' AND x.value_usd > 0
    AND (p_year IS NULL OR t.year <= p_year)
  ORDER BY t.country_id, t.year DESC
)
SELECT c.id,
  prod.item,
  (SELECT item FROM trade t WHERE t.country_id = c.id AND t.flow = 'export' AND t.basis = 'reported'),
  (SELECT item FROM trade t WHERE t.country_id = c.id AND t.flow = 'export' AND t.basis = 'mirror'),
  (SELECT item FROM trade t WHERE t.country_id = c.id AND t.flow = 'import' AND t.basis = 'reported'),
  (SELECT item FROM trade t WHERE t.country_id = c.id AND t.flow = 'import' AND t.basis = 'mirror'),
  holding.item,
  share.item
FROM countries c
LEFT JOIN prod ON prod.country_id = c.id
LEFT JOIN holding ON holding.country_id = c.id
LEFT JOIN share ON share.country_id = c.id
$$;

COMMENT ON FUNCTION gold_country_metrics(integer) IS
  'Each country''s latest figure per metric in or before p_year (NULL: latest available), as JSON objects that carry their own year or date. NULL means no data.';

CREATE VIEW v_gold_country_latest AS SELECT * FROM gold_country_metrics(NULL);

COMMENT ON VIEW v_gold_country_latest IS
  'Each country''s latest available figure per metric, each with its own year or date (gold_country_metrics(NULL)).';
COMMENT ON COLUMN v_gold_country_latest.country_id IS 'The country.';
COMMENT ON COLUMN v_gold_country_latest.production IS 'Mine production: year, tonnes, basis, computed USD value and the price used, source.';
COMMENT ON COLUMN v_gold_country_latest.exports_reported IS 'Gold exports as the country reports them: year, USD, net weight.';
COMMENT ON COLUMN v_gold_country_latest.exports_mirror IS 'Gold exports as partners report importing them: year, USD, net weight, partner count.';
COMMENT ON COLUMN v_gold_country_latest.imports_reported IS 'Gold imports as the country reports them.';
COMMENT ON COLUMN v_gold_country_latest.imports_mirror IS 'Gold imports as partners report exporting them.';
COMMENT ON COLUMN v_gold_country_latest.holdings IS 'Central bank holdings: month end, tonnes, USD, % of reserves, 12-month change.';
COMMENT ON COLUMN v_gold_country_latest.export_share IS 'Gold''s share of merchandise exports (same year for both parts).';

-- ── Africa's production by year, and which years are complete ───────────────

CREATE FUNCTION gold_production_years(scope_region text DEFAULT NULL)
RETURNS TABLE (
  year smallint,
  tonnes numeric,
  countries integer,
  missing_tonnes numeric,
  missing_countries integer,
  is_complete boolean
)
LANGUAGE sql STABLE AS $$
WITH scope AS (
  SELECT c.id FROM countries c JOIN regions g ON g.id = c.region_id
  WHERE scope_region IS NULL OR g.slug = scope_region
),
figures AS (
  SELECT p.country_id, p.year, p.tonnes
  FROM v_gold_production p JOIN scope s ON s.id = p.country_id
  WHERE p.tonnes IS NOT NULL
),
totals AS (
  SELECT f.year, sum(f.tonnes) AS tonnes, count(*)::int AS countries
  FROM figures f GROUP BY f.year
),
-- Producers with a figure within three years either side but none in the year: their nearest
-- figure estimates what the year's total is missing.
missing AS (
  SELECT t.year, sum(n.tonnes) AS tonnes, count(*)::int AS countries
  FROM totals t
  CROSS JOIN LATERAL (
    SELECT DISTINCT ON (f.country_id) f.country_id, f.tonnes
    FROM figures f
    WHERE f.tonnes > 0 AND f.year BETWEEN t.year - 3 AND t.year + 3
      AND NOT EXISTS (SELECT 1 FROM figures g WHERE g.country_id = f.country_id AND g.year = t.year)
    ORDER BY f.country_id, abs(f.year - t.year), f.year DESC
  ) n
  GROUP BY t.year
)
SELECT t.year, t.tonnes, t.countries, coalesce(m.tonnes, 0), coalesce(m.countries, 0),
  coalesce(m.tonnes, 0) <= 0.05 * (t.tonnes + coalesce(m.tonnes, 0))
FROM totals t LEFT JOIN missing m USING (year)
$$;

COMMENT ON FUNCTION gold_production_years(text) IS
  'Mine production summed per year (All Africa or a region), with an estimate of what is missing: producers with a figure within three years but none in that year. A year is complete when the missing share is at most 5%.';

-- ── The statistics band ──────────────────────────────────────────────────────

CREATE FUNCTION v_gold_stats(scope_region text DEFAULT NULL, as_of_year integer DEFAULT NULL)
RETURNS TABLE (
  key text,
  sort_order integer,
  label text,
  value numeric,
  unit text,
  as_of date,
  detail jsonb,
  entities jsonb,
  definition text
)
LANGUAGE sql STABLE AS $$
WITH scope AS (
  SELECT c.id, c.iso3, c.name FROM countries c JOIN regions g ON g.id = c.region_id
  WHERE scope_region IS NULL OR g.slug = scope_region
),
scope_name AS (
  SELECT coalesce((SELECT name FROM regions WHERE slug = scope_region), 'Africa') AS name
),
-- 1. Presence tiers (the latest evidence; not year-dependent).
tiers AS (
  SELECT p.presence_tier::text AS tier, count(*)::int AS n
  FROM country_gold_profiles p JOIN scope s ON s.id = p.country_id GROUP BY 1
),
-- 2–4. Production in the latest complete year up to the reference year.
years AS (SELECT * FROM gold_production_years(scope_region)),
ref_year AS (
  SELECT y.* FROM years y
  WHERE y.is_complete AND (as_of_year IS NULL OR y.year <= as_of_year)
  ORDER BY y.year DESC LIMIT 1
),
prev_year AS (
  SELECT y.* FROM years y JOIN ref_year r ON y.year = r.year - 1 WHERE y.is_complete
),
price_year AS (
  SELECT a.* FROM v_gold_price_annual a JOIN ref_year r ON a.year = r.year WHERE a.is_complete
),
world AS (
  SELECT w.* FROM v_gold_world_production w JOIN ref_year r ON w.year = r.year
),
producers AS (
  SELECT s.iso3, s.name, p.tonnes, p.basis
  FROM v_gold_production p JOIN scope s ON s.id = p.country_id JOIN ref_year r ON r.year = p.year
  WHERE p.tonnes IS NOT NULL
),
top_producers AS (
  SELECT jsonb_agg(jsonb_build_object(
           'kind', 'country', 'iso3', iso3, 'name', name, 'tonnes', tonnes,
           'estimate', basis = 'estimate') ORDER BY name) AS items,
         max(tonnes) AS tonnes
  FROM producers WHERE tonnes = (SELECT max(tonnes) FROM producers) AND tonnes > 0
),
-- 5, 6, 10. Central bank holdings: each country's latest month up to the reference year, kept
-- when it is within 12 months of the newest such month.
latest_holding AS (
  SELECT DISTINCT ON (r.country_id) r.*, s.iso3, s.name
  FROM gold_official_reserves r JOIN scope s ON s.id = r.country_id
  WHERE as_of_year IS NULL OR r.as_of <= make_date(as_of_year, 12, 31)
  ORDER BY r.country_id, r.as_of DESC
),
newest_month AS (SELECT max(as_of) AS as_of FROM latest_holding),
current_holding AS (
  SELECT h.*, prev.tonnes AS prev_tonnes
  FROM latest_holding h CROSS JOIN newest_month n
  LEFT JOIN gold_official_reserves prev
    ON prev.country_id = h.country_id
   AND prev.as_of = (date_trunc('month', h.as_of) - interval '11 months' - interval '1 day')::date
  WHERE h.as_of > (date_trunc('month', n.as_of) - interval '12 months')::date
),
holding_price AS (
  SELECT g.usd_per_troy_oz FROM gold_price_monthly g, newest_month n
  WHERE g.month = date_trunc('month', n.as_of)::date
),
top_holders AS (
  SELECT jsonb_agg(jsonb_build_object(
           'kind', 'country', 'iso3', iso3, 'name', name, 'tonnes', tonnes,
           'valueUsd', round(value_usd), 'pctOfReserves', pct_of_total_reserves, 'asOf', as_of)
         ORDER BY name) AS items,
         max(tonnes) AS tonnes, max(as_of) AS as_of
  FROM current_holding WHERE tonnes = (SELECT max(tonnes) FROM current_holding) AND tonnes > 0
),
net_buys AS (
  SELECT iso3, name, tonnes - prev_tonnes AS change, as_of FROM current_holding
  WHERE prev_tonnes IS NOT NULL
),
top_buyers AS (
  SELECT jsonb_agg(jsonb_build_object(
           'kind', 'country', 'iso3', iso3, 'name', name, 'changeTonnes', round(change, 3),
           'asOf', as_of) ORDER BY name) AS items,
         max(change) AS change, max(as_of) AS as_of
  FROM net_buys WHERE change = (SELECT max(change) FROM net_buys) AND change > 0
),
-- 7. The price.
price_month AS (
  SELECT g.month, g.usd_per_troy_oz,
    (SELECT p.usd_per_troy_oz FROM gold_price_monthly p
     WHERE p.month = (g.month - interval '12 months')::date) AS year_ago
  FROM gold_price_monthly g
  WHERE as_of_year IS NULL OR g.month <= make_date(as_of_year, 12, 1)
  ORDER BY g.month DESC LIMIT 1
),
-- 8. Gold's share of exports: each country's latest year with both parts, kept when within
-- three years of the newest such year.
shares AS (
  SELECT DISTINCT ON (t.country_id) s.iso3, s.name, t.year,
    100 * t.value_usd / x.value_usd AS pct, t.value_usd AS gold, x.value_usd AS total
  FROM gold_trade_annual t
  JOIN country_total_exports_annual x ON x.country_id = t.country_id AND x.year = t.year
  JOIN scope s ON s.id = t.country_id
  WHERE t.flow = 'export' AND t.basis = 'reported' AND x.value_usd > 0
    AND t.value_usd <= x.value_usd AND (as_of_year IS NULL OR t.year <= as_of_year)
  ORDER BY t.country_id, t.year DESC
),
recent_shares AS (
  SELECT * FROM shares WHERE year >= (SELECT max(year) FROM shares) - 3
),
top_shares AS (
  SELECT jsonb_agg(jsonb_build_object(
           'kind', 'country', 'iso3', iso3, 'name', name, 'pct', round(pct, 1), 'year', year,
           'goldUsd', round(gold), 'totalUsd', round(total)) ORDER BY name) AS items,
         max(pct) AS pct, max(year) AS year
  FROM recent_shares WHERE round(pct, 1) = (SELECT max(round(pct, 1)) FROM recent_shares)
),
-- 9. The reporting gap: partners' reported imports minus the country's reported exports, in its
-- latest year with both, up to the year before the newest trade year (partners report late).
trade_cap AS (
  SELECT least(coalesce(as_of_year, 9999), max(year) - 1) AS year
  FROM gold_trade_annual WHERE flow = 'export'
),
gaps AS (
  SELECT DISTINCT ON (r.country_id) s.iso3, s.name, r.year,
    m.value_usd - r.value_usd AS gap, r.value_usd AS reported, m.value_usd AS mirror,
    m.partner_count
  FROM gold_trade_annual r
  JOIN gold_trade_annual m
    ON m.country_id = r.country_id AND m.year = r.year AND m.flow = 'export' AND m.basis = 'mirror'
  JOIN scope s ON s.id = r.country_id
  CROSS JOIN trade_cap c
  WHERE r.flow = 'export' AND r.basis = 'reported' AND r.year <= c.year
  ORDER BY r.country_id, r.year DESC
),
recent_gaps AS (
  SELECT * FROM gaps WHERE year >= (SELECT max(year) FROM gaps) - 3
),
top_gaps AS (
  SELECT jsonb_agg(jsonb_build_object(
           'kind', 'country', 'iso3', iso3, 'name', name, 'year', year,
           'gapUsd', round(gap), 'reportedUsd', round(reported), 'mirrorUsd', round(mirror),
           'partnerCount', partner_count) ORDER BY name) AS items,
         max(gap) AS gap, max(year) AS year
  FROM recent_gaps WHERE gap = (SELECT max(gap) FROM recent_gaps) AND gap > 0
)
SELECT 'gold_producing_countries', 1, 'Gold-producing countries',
  (SELECT coalesce(sum(n), 0) FROM tiers WHERE tier IN ('major_producer', 'producer')), 'countries',
  NULL::date,
  jsonb_build_object(
    'majorProducer', coalesce((SELECT n FROM tiers WHERE tier = 'major_producer'), 0),
    'producer', coalesce((SELECT n FROM tiers WHERE tier = 'producer'), 0),
    'occurrencesKnown', coalesce((SELECT n FROM tiers WHERE tier = 'occurrences_known'), 0),
    'noneIdentified', coalesce((SELECT n FROM tiers WHERE tier = 'none_identified'), 0),
    'unknown', coalesce((SELECT n FROM tiers WHERE tier = 'unknown'), 0),
    'countries', (SELECT count(*)::int FROM scope)),
  '[]'::jsonb,
  'Countries whose presence tier is "major producer" (latest production figure of 20 t or more) or "producer" (above 0 t), out of the countries in scope. Tiers rest on the latest evidence in the sources consulted (USGS figures, notes and cited overrides), not on the reference year; "none identified" means none in the sources consulted, never "no gold".'
UNION ALL
SELECT 'africa_production', 2,
  (SELECT name FROM scope_name) || '''s gold mine production',
  (SELECT round(tonnes, 1) FROM ref_year), 't',
  (SELECT make_date(year, 12, 31) FROM ref_year),
  jsonb_build_object(
    'year', (SELECT year FROM ref_year),
    'countries', (SELECT countries FROM ref_year),
    'missingCountries', (SELECT missing_countries FROM ref_year),
    'worldTonnes', (SELECT tonnes FROM world),
    'worldSharePct', (SELECT round(100 * r.tonnes / w.tonnes, 1) FROM ref_year r, world w),
    'previousYear', (SELECT year FROM prev_year),
    'changeTonnes', (SELECT round(r.tonnes - p.tonnes, 1) FROM ref_year r, prev_year p),
    'changePct', (SELECT round(100 * (r.tonnes - p.tonnes) / p.tonnes, 1) FROM ref_year r, prev_year p WHERE p.tonnes > 0),
    'newestYear', (SELECT max(year) FROM years WHERE as_of_year IS NULL OR year <= as_of_year)),
  '[]'::jsonb,
  'The sum of each country''s mine production figure (USGS; one figure per country-year, a reported figure over an estimate, then the newest edition) in the latest complete year up to the reference year. A year is complete when producers without a figure that year (estimated from their nearest figure within three years) would add at most 5%; newer years cover only the countries the USGS lists by name. The share of world output uses the USGS world total for the same year.'
UNION ALL
SELECT 'production_value', 3, 'Value of that production',
  (SELECT round(r.tonnes * troy_oz_per_tonne() * p.mean_usd_per_troy_oz) FROM ref_year r, price_year p),
  'USD',
  (SELECT make_date(year, 12, 31) FROM ref_year),
  jsonb_build_object(
    'year', (SELECT year FROM ref_year),
    'priceUsdPerOz', (SELECT round(mean_usd_per_troy_oz, 2) FROM price_year),
    'computed', true),
  '[]'::jsonb,
  'Computed, not reported: that year''s production × 32,150.7466 troy ounces per tonne × the year''s average of the World Bank''s monthly gold prices (nominal US dollars). It is what the gold was worth at the average price, not a sales or export figure.'
UNION ALL
SELECT 'largest_producer', 4, 'Largest producer',
  (SELECT tonnes FROM top_producers), 't',
  (SELECT make_date(year, 12, 31) FROM ref_year),
  jsonb_build_object(
    'year', (SELECT year FROM ref_year),
    'sharePct', (SELECT round(100 * t.tonnes / r.tonnes, 1) FROM top_producers t, ref_year r WHERE r.tonnes > 0)),
  coalesce((SELECT items FROM top_producers), '[]'::jsonb),
  'The country with the most mine production in the same year as the production card, and its share of the total. Ties are all shown.'
UNION ALL
SELECT 'central_bank_gold', 5, 'Central bank gold held',
  (SELECT round(sum(tonnes), 1) FROM current_holding), 't',
  (SELECT as_of FROM newest_month),
  jsonb_build_object(
    'valueUsd', (SELECT round(sum(c.tonnes) * troy_oz_per_tonne() * p.usd_per_troy_oz) FROM current_holding c, holding_price p GROUP BY p.usd_per_troy_oz),
    'priceUsdPerOz', (SELECT usd_per_troy_oz FROM holding_price),
    'reporting', (SELECT count(*)::int FROM current_holding),
    'notCurrent', (SELECT count(*)::int FROM scope) - (SELECT count(*)::int FROM current_holding)),
  '[]'::jsonb,
  'The sum of the gold held by central banks (IMF International Liquidity), using each country''s latest month up to the reference year and counting only countries whose latest report is within 12 months of the newest one. Late, irregular and pooled reporters (the eight BCEAO members hold gold jointly) are left out and counted. The US dollar value is the total tonnes at the newest month''s average price (computed).'
UNION ALL
SELECT 'largest_holder', 6, 'Largest holder',
  (SELECT tonnes FROM top_holders), 't',
  (SELECT as_of FROM top_holders),
  '{}'::jsonb,
  coalesce((SELECT items FROM top_holders), '[]'::jsonb),
  'The central bank with the most gold among the countries counted in "Central bank gold held", with its US dollar value (at that month''s average price) and gold''s share of its total reserves (from the IMF''s own values). Ties are all shown.'
UNION ALL
SELECT 'gold_price', 7, 'Gold price',
  (SELECT round(usd_per_troy_oz, 2) FROM price_month), 'USD/oz',
  (SELECT (month + interval '1 month - 1 day')::date FROM price_month),
  jsonb_build_object(
    'month', (SELECT month FROM price_month),
    'yearAgoUsdPerOz', (SELECT year_ago FROM price_month),
    'changePct', (SELECT round(100 * (usd_per_troy_oz - year_ago) / year_ago, 1) FROM price_month WHERE year_ago > 0)),
  '[]'::jsonb,
  'The World Bank''s monthly average gold price for the latest month up to the reference year, in nominal US dollars per troy ounce, and its change from the same month a year earlier. A monthly average, not a live price.'
UNION ALL
SELECT 'most_gold_dependent', 8, 'Most gold-dependent exporter',
  (SELECT round(pct, 1) FROM top_shares), '%',
  (SELECT make_date(year, 12, 31) FROM top_shares),
  '{}'::jsonb,
  coalesce((SELECT items FROM top_shares), '[]'::jsonb),
  'The country whose reported gold exports (HS 7108, non-monetary gold) are the largest share of its reported merchandise exports, both parts from UN Comtrade for the same year: each country''s latest year with both, up to the reference year and within three years of the newest such year. Ties are all shown.'
UNION ALL
SELECT 'biggest_reporting_gap', 9, 'Biggest reporting gap',
  (SELECT round(gap) FROM top_gaps), 'USD',
  (SELECT make_date(year, 12, 31) FROM top_gaps),
  '{}'::jsonb,
  coalesce((SELECT items FROM top_gaps), '[]'::jsonb),
  'Where trading partners report importing the most gold from a country beyond what that country reports exporting (UN Comtrade, non-monetary gold): each country''s latest year with both figures, up to the reference year and at most the year before the newest trade data (partners report late), within three years of the newest such year. Gaps can reflect timing, valuation, classification, transit or unrecorded flows; a gap is not evidence of wrongdoing.'
UNION ALL
SELECT 'largest_net_buyer', 10, 'Largest net buyer (12 months)',
  (SELECT round(change, 3) FROM top_buyers), 't',
  (SELECT as_of FROM top_buyers),
  jsonb_build_object('noNetBuyer', NOT EXISTS (SELECT 1 FROM top_buyers WHERE items IS NOT NULL)),
  coalesce((SELECT items FROM top_buyers), '[]'::jsonb),
  'The central bank whose gold holdings grew most, in tonnes, over the 12 months to its latest report (among the countries counted in "Central bank gold held"). "No net buyer" when no holding grew.'
$$;

COMMENT ON FUNCTION v_gold_stats(text, integer) IS
  'The Dhahabu statistics band for All Africa (NULL) or one region, at a reference year (NULL: latest available). Definitions and tie rules: docs/dhahabu-stats.md.';
