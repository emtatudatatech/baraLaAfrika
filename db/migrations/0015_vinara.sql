-- 0015_vinara.sql
-- Vinara (Swahili: leaders): for each metric, the cardinal (the leading state) and the silent
-- contender (the runner-up), for Africa and for each UN M49 region, whether the lead is
-- narrowing, and the regions compared with one another. Every rule is computed here; the text
-- of each definition is in docs/vinara-method.md, word for word (a test keeps them identical).

-- ── Metrics ──────────────────────────────────────────────────────────────────

CREATE TABLE vinara_metrics (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  sort_order      smallint NOT NULL UNIQUE,
  name            text NOT NULL,
  measure         text NOT NULL CHECK (
                    measure IN ('latest', 'mean', 'mean_abs', 'fx_change', 'fx_volatility')),
  indicator_key   text,
  direction       text NOT NULL CHECK (direction IN ('max', 'min')),
  kind            text NOT NULL CHECK (kind IN ('level', 'rate')),
  unit            text NOT NULL,
  decimals        smallint NOT NULL CHECK (decimals BETWEEN 0 AND 6),
  regional        text NOT NULL CHECK (
                    regional IN ('sum', 'per_capita', 'gdp_weighted', 'gdp_weighted_latest',
                                 'pop_weighted', 'median')),
  definition      text NOT NULL,
  unranked_reason text NOT NULL,
  CHECK ((measure LIKE 'fx_%') = (indicator_key IS NULL))
);

COMMENT ON TABLE vinara_metrics IS
  'The metrics Vinara ranks: how each is measured over the window, which way leads, and how regions are aggregated.';
COMMENT ON COLUMN vinara_metrics.key IS 'Stable key used by the API.';
COMMENT ON COLUMN vinara_metrics.sort_order IS 'Display order.';
COMMENT ON COLUMN vinara_metrics.name IS 'Display name.';
COMMENT ON COLUMN vinara_metrics.measure IS
  'latest (the latest figure in the window), mean or mean_abs (of the annual figures), fx_change (the currency''s change over the window), fx_volatility (annualised volatility of monthly changes).';
COMMENT ON COLUMN vinara_metrics.indicator_key IS 'The indicator measured (indicators.key); NULL for the exchange-rate metrics.';
COMMENT ON COLUMN vinara_metrics.direction IS 'max: the largest leads; min: the smallest leads.';
COMMENT ON COLUMN vinara_metrics.kind IS 'level or rate: decides how the gap-closing signal is read.';
COMMENT ON COLUMN vinara_metrics.unit IS 'The unit of the ranked value.';
COMMENT ON COLUMN vinara_metrics.decimals IS 'The precision values are compared at (equal values at it are ties).';
COMMENT ON COLUMN vinara_metrics.regional IS
  'How a region''s figure is made: sum, per_capita (GDP at PPP over population), gdp_weighted (per year, by the previous year''s GDP), gdp_weighted_latest, pop_weighted, or median (each currency once).';
COMMENT ON COLUMN vinara_metrics.definition IS 'The definition the site shows (docs/vinara-method.md, word for word).';
COMMENT ON COLUMN vinara_metrics.unranked_reason IS 'Why a state without a value takes no part, in words.';

INSERT INTO vinara_metrics VALUES
  ('population', 1, 'Population', 'latest', 'population', 'max', 'level', 'people', 0, 'sum',
   'The latest population in the window (World Bank). The largest leads.',
   'No population figure in the window'),
  ('land_area', 2, 'Land area', 'latest', 'land_area', 'max', 'level', 'km2', 0, 'sum',
   'Land area in square kilometres, excluding inland water: the latest figure in the window (World Bank). The largest leads.',
   'No land area figure in the window'),
  ('gdp_usd', 3, 'GDP', 'latest', 'gdp_usd', 'max', 'level', 'current_usd', 0, 'sum',
   'GDP in current US dollars: the latest figure in the window (World Bank; an IMF estimate where the World Bank has none for the latest year). The largest leads.',
   'No GDP figure in the window'),
  ('gdp_ppp', 4, 'GDP at purchasing power parity', 'latest', 'gdp_ppp', 'max', 'level',
   'current_intl_usd', 0, 'sum',
   'GDP at purchasing power parity, in current international dollars: the latest figure in the window (World Bank; an IMF estimate where the World Bank has none for the latest year). The largest leads.',
   'No GDP at PPP figure in the window'),
  ('gdp_per_capita_ppp', 5, 'GDP per capita (PPP)', 'latest', 'gdp_per_capita_ppp', 'max', 'level',
   'current_intl_usd', 0, 'per_capita',
   'GDP per person at purchasing power parity, in current international dollars: the latest figure in the window. The largest leads.',
   'No GDP per capita figure in the window'),
  ('gdp_growth', 6, 'Real GDP growth', 'mean', 'gdp_growth', 'max', 'rate', 'percent', 2,
   'gdp_weighted',
   'Real GDP growth: the mean of the annual rates over the window, for states with a figure in at least 80% of its years. The highest leads.',
   'Growth figures for fewer than 80% of the window''s years'),
  ('inflation', 7, 'Inflation', 'mean_abs', 'inflation', 'min', 'rate', 'percent', 2,
   'gdp_weighted',
   'Inflation: the mean of the absolute annual rates over the window, so that deflation counts as a departure from stable prices too, for states with a figure in at least 80% of its years. The lowest leads.',
   'Inflation figures for fewer than 80% of the window''s years'),
  ('government_debt', 8, 'Government debt', 'latest', 'government_debt', 'min', 'level',
   'percent_of_gdp', 2, 'gdp_weighted_latest',
   'General government gross debt as a share of GDP: the latest figure in the window (IMF; its figure for the year before its latest edition is an estimate). The lowest leads.',
   'No government debt figure in the window'),
  ('gni_usd', 9, 'GNI', 'latest', 'gni_usd', 'max', 'level', 'current_usd', 0, 'sum',
   'GNI in current US dollars: the latest figure in the window (World Bank). The largest leads.',
   'No GNI figure in the window'),
  ('currency_performance', 10, 'Currency performance', 'fx_change', NULL, 'max', 'rate',
   'percent', 2, 'median',
   'The change in the currency''s value against the US dollar from the first month of the window to its last, on monthly averages (of official daily rates where a state has them, otherwise the IMF''s). A rise means the currency gained. The largest gain, or the smallest loss, leads.',
   'No exchange rate for the window''s first or last month'),
  ('currency_stability', 11, 'Currency stability', 'fx_volatility', NULL, 'min', 'rate', 'percent',
   2, 'median',
   'The volatility of the currency against the US dollar: the standard deviation of its monthly changes over the window, annualised, for currencies with rates in at least 90% of the window''s months. The lowest leads.',
   'Exchange rates for fewer than 90% of the window''s months'),
  ('military_usd', 12, 'Military spending', 'latest', 'military_usd', 'max', 'level',
   'current_usd', 0, 'sum',
   'Military expenditure in current US dollars: the latest figure in the window (SIPRI). The largest leads.',
   'No military spending figure in the window'),
  ('hdi', 13, 'Human development', 'latest', 'hdi', 'max', 'level', 'index', 3, 'pop_weighted',
   'The Human Development Index: the latest figure in the window (UNDP). The highest leads.',
   'No Human Development Index figure in the window');

-- ── Monthly exchange rates on one basis ──────────────────────────────────────

CREATE VIEW v_fx_month AS
WITH daily AS (
  SELECT cc.country_id, date_trunc('month', d.day)::date AS month, avg(d.per_usd) AS per_usd
  FROM fx_daily d JOIN country_currencies cc ON cc.currency_code = d.currency_code
  GROUP BY 1, 2
)
SELECT
  coalesce(d.country_id, m.country_id) AS country_id,
  coalesce(d.month, m.month) AS month,
  coalesce(d.per_usd, m.per_usd_avg) AS per_usd,
  CASE WHEN d.per_usd IS NOT NULL THEN 'daily' ELSE 'imf' END AS basis
FROM daily d
FULL JOIN fx_monthly m ON m.country_id = d.country_id AND m.month = d.month
WHERE coalesce(d.per_usd, m.per_usd_avg) IS NOT NULL;

COMMENT ON VIEW v_fx_month IS
  'Each state''s monthly exchange rate on one basis for ranking: the mean of its official daily rates where it has them, otherwise the IMF''s monthly average (units per US dollar).';
COMMENT ON COLUMN v_fx_month.country_id IS 'The country.';
COMMENT ON COLUMN v_fx_month.month IS 'First day of the month.';
COMMENT ON COLUMN v_fx_month.per_usd IS 'Units of local currency per US dollar.';
COMMENT ON COLUMN v_fx_month.basis IS 'daily (mean of daily rates) or imf (the IMF''s monthly average).';

-- ── Annual values per metric ─────────────────────────────────────────────────

CREATE FUNCTION vinara_country_years(p_metric text)
RETURNS TABLE (country_id integer, year integer, value numeric, estimate boolean)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT * FROM vinara_metrics WHERE key = p_metric),
  fx AS (SELECT f.country_id, f.month, f.per_usd FROM v_fx_month f),
  returns AS (
    SELECT f.country_id, f.month, ln(p.per_usd / f.per_usd) AS r
    FROM fx f JOIN fx p ON p.country_id = f.country_id AND p.month = (f.month - interval '1 month')::date
  )
  SELECT o.country_id, o.year::integer,
         CASE WHEN m.measure = 'mean_abs' THEN abs(o.value) ELSE o.value END,
         o.basis = 'estimate'
  FROM m
  JOIN indicators i ON i.key = m.indicator_key
  JOIN indicator_observations o ON o.indicator_id = i.id
  UNION ALL
  -- The currency's change over each calendar year, January to December.
  SELECT j.country_id, extract(year FROM j.month)::integer, (j.per_usd / d.per_usd - 1) * 100, false
  FROM m, fx j
  JOIN fx d ON d.country_id = j.country_id AND d.month = (j.month + interval '11 months')::date
  WHERE m.measure = 'fx_change' AND extract(month FROM j.month) = 1
  UNION ALL
  -- Each calendar year's volatility of monthly changes, annualised.
  SELECT r.country_id, extract(year FROM r.month)::integer, stddev_samp(r.r) * sqrt(12) * 100, false
  FROM m, returns r
  WHERE m.measure = 'fx_volatility'
  GROUP BY r.country_id, extract(year FROM r.month)
  HAVING count(*) >= 11
$$;
COMMENT ON FUNCTION vinara_country_years(text) IS
  'A metric''s annual values per state: the indicator''s figures (absolute values for mean_abs), or each year''s currency change and volatility. Used for windows and the gap-closing signal.';

-- ── The window ───────────────────────────────────────────────────────────────

CREATE FUNCTION vinara_window(p_metric text, p_from integer DEFAULT NULL, p_to integer DEFAULT NULL)
RETURNS TABLE (from_year integer, to_year integer, is_default boolean)
LANGUAGE sql STABLE AS $$
  -- Both currency metrics use one window, set by the currency changes' coverage.
  WITH basis AS (
    SELECT CASE WHEN m.measure LIKE 'fx_%' THEN 'currency_performance' ELSE m.key END AS key
    FROM vinara_metrics m WHERE m.key = p_metric
  ),
  y AS (
    SELECT cy.year, count(DISTINCT cy.country_id) AS n
    FROM basis, vinara_country_years(basis.key) cy GROUP BY cy.year
  ),
  bounds AS (
    SELECT min(year) AS first_year, max(year) AS last_year,
           max(year) FILTER (WHERE n >= 0.9 * (SELECT count(*) FROM countries)) AS last_complete
    FROM y
  ),
  t AS (
    SELECT b.first_year,
           least(greatest(coalesce(p_to, b.last_complete, b.last_year), b.first_year), b.last_year) AS to_year
    FROM bounds b
  )
  SELECT least(greatest(coalesce(p_from, t.to_year - 9), t.first_year), t.to_year), t.to_year,
         p_from IS NULL AND p_to IS NULL
  FROM t
$$;
COMMENT ON FUNCTION vinara_window(text, integer, integer) IS
  'The years a metric is measured over: by default the last ten complete years (a year is complete when at least 90% of the states have a figure; both currency metrics follow the currency changes), never beyond the data; a given range is kept within the data.';

-- ── Each state's value over a window ─────────────────────────────────────────

CREATE FUNCTION vinara_country_values(p_metric text, p_from integer, p_to integer)
RETURNS TABLE (country_id integer, value numeric, year integer, years_covered integer, estimate boolean)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT * FROM vinara_metrics WHERE key = p_metric),
  y AS (
    SELECT cy.* FROM vinara_country_years(p_metric) cy WHERE cy.year BETWEEN p_from AND p_to
  ),
  fx AS (
    SELECT f.country_id, f.month, f.per_usd FROM v_fx_month f
    WHERE f.month BETWEEN make_date(p_from, 1, 1) AND make_date(p_to, 12, 1)
  ),
  returns AS (
    SELECT f.country_id, ln(p.per_usd / f.per_usd) AS r
    FROM fx f JOIN fx p ON p.country_id = f.country_id AND p.month = (f.month - interval '1 month')::date
  )
  (SELECT DISTINCT ON (y.country_id) y.country_id, y.value, y.year, 1, y.estimate
   FROM y, m WHERE m.measure = 'latest'
   ORDER BY y.country_id, y.year DESC)
  UNION ALL
  SELECT y.country_id, avg(y.value), max(y.year), count(*)::integer, bool_or(y.estimate)
  FROM y, m WHERE m.measure IN ('mean', 'mean_abs')
  GROUP BY y.country_id
  HAVING count(*) >= ceil(0.8 * (p_to - p_from + 1))
  UNION ALL
  SELECT f.country_id, (f.per_usd / l.per_usd - 1) * 100, p_to, p_to - p_from + 1, false
  FROM m, fx f
  JOIN fx l ON l.country_id = f.country_id AND l.month = make_date(p_to, 12, 1)
  WHERE m.measure = 'fx_change' AND f.month = make_date(p_from, 1, 1)
  UNION ALL
  SELECT r.country_id, stddev_samp(r.r) * sqrt(12) * 100, p_to, p_to - p_from + 1, false
  FROM m, returns r WHERE m.measure = 'fx_volatility'
  GROUP BY r.country_id
  HAVING count(*) >= 0.9 * (12 * (p_to - p_from + 1) - 1)
$$;
COMMENT ON FUNCTION vinara_country_values(text, integer, integer) IS
  'Each state''s value of a metric over a window (latest figure, mean of annual figures, currency change or volatility); states without enough data have no row.';

CREATE FUNCTION vinara_rankings(p_metric text, p_region text, p_from integer, p_to integer)
RETURNS TABLE (country_id integer, iso3 text, name text, region text, value numeric, year integer,
               estimate boolean, rank integer)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.iso3::text, c.name, r.slug, round(v.value, m.decimals), v.year, v.estimate,
         rank() OVER (ORDER BY CASE WHEN m.direction = 'max' THEN -round(v.value, m.decimals)
                                    ELSE round(v.value, m.decimals) END)::integer
  FROM vinara_metrics m
  JOIN vinara_country_values(p_metric, p_from, p_to) v ON true
  JOIN countries c ON c.id = v.country_id
  JOIN regions r ON r.id = c.region_id
  WHERE m.key = p_metric AND (p_region IS NULL OR r.slug = p_region)
$$;
COMMENT ON FUNCTION vinara_rankings(text, text, integer, integer) IS
  'States ranked by a metric over a window, in Africa or one region; values equal at the metric''s precision share a rank.';

-- ── Is the cardinal's lead narrowing? ────────────────────────────────────────

CREATE FUNCTION vinara_signal(p_metric text, p_to integer, p_cardinal integer, p_contender integer)
RETURNS TABLE (signal text, contender_leads_latest boolean)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT * FROM vinara_metrics WHERE key = p_metric),
  y AS (
    SELECT cy.country_id, cy.year,
           CASE WHEN m.direction = 'max' THEN cy.value ELSE -cy.value END AS v
    FROM m, vinara_country_years(p_metric) cy
    WHERE cy.country_id IN (p_cardinal, p_contender) AND cy.year BETWEEN p_to - 3 AND p_to
  ),
  pairs AS (
    SELECT a.year, a.v AS card, b.v AS cont
    FROM y a JOIN y b ON b.year = a.year AND b.country_id = p_contender
    WHERE a.country_id = p_cardinal
  ),
  gaps AS (
    SELECT year, card - cont AS gap, lag(card - cont) OVER (ORDER BY year) AS previous FROM pairs
  )
  SELECT
    CASE
      WHEN m.kind = 'level' THEN
        CASE
          WHEN (SELECT count(*) FROM pairs) < 4 THEN 'not_enough_data'
          WHEN (SELECT count(*) FROM gaps WHERE gap < previous) = 3 THEN 'gap_closing'
          ELSE 'lead_holding'
        END
      ELSE
        CASE
          WHEN (SELECT count(*) FROM pairs WHERE year > p_to - 3) < 3 THEN 'not_enough_data'
          WHEN (SELECT count(*) FROM pairs WHERE year > p_to - 3 AND cont > card) >= 2 THEN 'gap_closing'
          ELSE 'lead_holding'
        END
    END,
    coalesce((SELECT cont > card FROM pairs WHERE year = p_to), false)
  FROM m
$$;
COMMENT ON FUNCTION vinara_signal(text, integer, integer, integer) IS
  'Whether the gap between cardinal and contender is closing: for levels, it narrowed in each of the last three annual steps; for rates, the contender did better in at least two of the last three years. Also whether the contender led in the window''s last year.';

-- ── Regions ──────────────────────────────────────────────────────────────────

CREATE FUNCTION vinara_region_values(p_metric text, p_from integer, p_to integer)
RETURNS TABLE (region_id integer, value numeric, median numeric, coverage numeric)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT * FROM vinara_metrics WHERE key = p_metric),
  cv AS (SELECT * FROM vinara_country_values(p_metric, p_from, p_to)),
  pop AS (SELECT * FROM vinara_country_values('population', p_from, p_to)),
  gdp AS (SELECT * FROM vinara_country_values('gdp_usd', p_from, p_to)),
  members AS (
    SELECT c.id AS country_id, c.region_id, cc.currency_code,
           cv.value, cv.year, pop.value AS population, gdp.value AS gdp
    FROM countries c
    LEFT JOIN cv ON cv.country_id = c.id
    LEFT JOIN pop ON pop.country_id = c.id
    LEFT JOIN gdp ON gdp.country_id = c.id
    LEFT JOIN country_currencies cc ON cc.country_id = c.id
  ),
  -- Coverage by population (sums, per capita, population-weighted, currencies) or GDP.
  by_population AS (
    SELECT region_id,
           sum(population) FILTER (WHERE value IS NOT NULL) / nullif(sum(population), 0) AS share
    FROM members GROUP BY region_id
  ),
  by_gdp AS (
    SELECT region_id, sum(gdp) FILTER (WHERE value IS NOT NULL) / nullif(sum(gdp), 0) AS share
    FROM members GROUP BY region_id
  ),
  medians AS (
    SELECT region_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::numeric AS median
    FROM members WHERE value IS NOT NULL GROUP BY region_id
  ),
  sums AS (
    SELECT region_id, sum(value) AS value FROM members GROUP BY region_id
  ),
  per_capita AS (
    SELECT mb.region_id, sum(p.value) / nullif(sum(mb.population), 0) AS value,
           sum(mb.population) FILTER (WHERE p.value IS NOT NULL) / nullif(sum(mb.population), 0) AS share
    FROM members mb
    LEFT JOIN vinara_country_values('gdp_ppp', p_from, p_to) p ON p.country_id = mb.country_id
    WHERE p.value IS NOT NULL OR mb.population IS NOT NULL
    GROUP BY mb.region_id
  ),
  -- Rates: each year's GDP-weighted mean (weights: the previous year's GDP), then their mean.
  weights AS (
    SELECT o.country_id, o.year, o.value AS gdp
    FROM indicator_observations o JOIN indicators i ON i.id = o.indicator_id
    WHERE i.key = 'gdp_usd'
  ),
  yearly AS (
    SELECT c.region_id, cy.year,
           sum(cy.value * w.gdp) / nullif(sum(w.gdp), 0) AS value,
           sum(w.gdp) / nullif((SELECT sum(w2.gdp) FROM weights w2 JOIN countries c2 ON c2.id = w2.country_id
                                WHERE c2.region_id = c.region_id AND w2.year = cy.year - 1), 0) AS share
    FROM vinara_country_years(p_metric) cy
    JOIN countries c ON c.id = cy.country_id
    JOIN weights w ON w.country_id = cy.country_id AND w.year = cy.year - 1
    WHERE cy.year BETWEEN p_from AND p_to
    GROUP BY c.region_id, cy.year
  ),
  gdp_weighted AS (
    SELECT region_id, avg(value) AS value, min(share) AS share,
           count(*) AS years FROM yearly GROUP BY region_id
  ),
  -- Debt: weighted by GDP in the year of each state's debt figure.
  latest_weighted AS (
    SELECT mb.region_id, sum(mb.value * w.gdp) / nullif(sum(w.gdp), 0) AS value
    FROM members mb JOIN weights w ON w.country_id = mb.country_id AND w.year = mb.year
    WHERE mb.value IS NOT NULL GROUP BY mb.region_id
  ),
  pop_years AS (
    SELECT o.country_id, o.year, o.value AS population
    FROM indicator_observations o JOIN indicators i ON i.id = o.indicator_id
    WHERE i.key = 'population'
  ),
  pop_weighted AS (
    SELECT mb.region_id, sum(mb.value * py.population) / nullif(sum(py.population), 0) AS value
    FROM members mb JOIN pop_years py ON py.country_id = mb.country_id AND py.year = mb.year
    WHERE mb.value IS NOT NULL GROUP BY mb.region_id
  ),
  -- Currencies: the median over the region's currencies, each currency once.
  currencies AS (
    SELECT DISTINCT ON (region_id, currency_code) region_id, currency_code, value
    FROM members WHERE value IS NOT NULL ORDER BY region_id, currency_code, country_id
  ),
  currency_medians AS (
    SELECT region_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::numeric AS value
    FROM currencies GROUP BY region_id
  )
  SELECT r.id,
         CASE m.regional
           WHEN 'sum' THEN s.value
           WHEN 'per_capita' THEN pc.value
           WHEN 'gdp_weighted' THEN gw.value
           WHEN 'gdp_weighted_latest' THEN lw.value
           WHEN 'pop_weighted' THEN pw.value
           ELSE cm.value
         END,
         md.median,
         coalesce(CASE m.regional
           WHEN 'per_capita' THEN pc.share
           WHEN 'gdp_weighted' THEN
             CASE WHEN gw.years = p_to - p_from + 1 THEN gw.share ELSE 0 END
           WHEN 'gdp_weighted_latest' THEN bg.share
           ELSE bp.share
         END, 0)
  FROM regions r
  CROSS JOIN m
  LEFT JOIN sums s ON s.region_id = r.id
  LEFT JOIN per_capita pc ON pc.region_id = r.id
  LEFT JOIN gdp_weighted gw ON gw.region_id = r.id
  LEFT JOIN latest_weighted lw ON lw.region_id = r.id
  LEFT JOIN pop_weighted pw ON pw.region_id = r.id
  LEFT JOIN currency_medians cm ON cm.region_id = r.id
  LEFT JOIN medians md ON md.region_id = r.id
  LEFT JOIN by_population bp ON bp.region_id = r.id
  LEFT JOIN by_gdp bg ON bg.region_id = r.id
$$;
COMMENT ON FUNCTION vinara_region_values(text, integer, integer) IS
  'Each region''s figure for a metric over a window (sum, per capita, GDP- or population-weighted mean, or median over its currencies), the median over its states, and the share of the region (by population or GDP) the figure covers.';

-- ── One scope's summary ──────────────────────────────────────────────────────

CREATE FUNCTION vinara_summary(p_region text DEFAULT NULL, p_from integer DEFAULT NULL,
                               p_to integer DEFAULT NULL, p_metric text DEFAULT NULL)
RETURNS TABLE (metric text, from_year integer, to_year integer, is_default boolean,
               cardinals jsonb, contenders jsonb, signal text, contender_leads_latest boolean,
               ranked integer, unranked jsonb, region_cardinals jsonb, region_contenders jsonb,
               regions jsonb)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  m record;
  w record;
  s record;
  ranking jsonb;
  next_rank integer;
  card_ids integer[];
  cont_ids integer[];
BEGIN
  -- Read-only callers cannot create tables, so each ranking is held as JSON.
  FOR m IN SELECT * FROM vinara_metrics WHERE p_metric IS NULL OR key = p_metric
           ORDER BY sort_order LOOP
    SELECT * INTO w FROM vinara_window(m.key, p_from, p_to);
    -- A metric with no data at all has no window and is left out.
    CONTINUE WHEN w.to_year IS NULL;
    metric := m.key;
    from_year := w.from_year;
    to_year := w.to_year;
    is_default := w.is_default;

    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO ranking
      FROM vinara_rankings(m.key, p_region, w.from_year, w.to_year) r;

    SELECT min(x.rank) INTO next_rank
      FROM jsonb_to_recordset(ranking) AS x(rank integer) WHERE x.rank > 1;
    SELECT coalesce(jsonb_agg(jsonb_build_object('iso3', x.iso3, 'name', x.name,
             'region', x.region, 'value', x.value, 'year', x.year, 'estimate', x.estimate)
             ORDER BY x.name), '[]'::jsonb),
           array_agg(x.country_id)
      INTO cardinals, card_ids
      FROM jsonb_to_recordset(ranking) AS x(country_id integer, iso3 text, name text,
           region text, value numeric, year integer, estimate boolean, rank integer)
     WHERE x.rank = 1;
    SELECT coalesce(jsonb_agg(jsonb_build_object('iso3', x.iso3, 'name', x.name,
             'region', x.region, 'value', x.value, 'year', x.year, 'estimate', x.estimate)
             ORDER BY x.name), '[]'::jsonb),
           array_agg(x.country_id)
      INTO contenders, cont_ids
      FROM jsonb_to_recordset(ranking) AS x(country_id integer, iso3 text, name text,
           region text, value numeric, year integer, estimate boolean, rank integer)
     WHERE x.rank = next_rank;
    ranked := jsonb_array_length(ranking);

    -- The signal needs one cardinal and one contender; ties are named, never broken.
    IF coalesce(array_length(card_ids, 1), 0) = 1 AND coalesce(array_length(cont_ids, 1), 0) = 1 THEN
      SELECT * INTO s FROM vinara_signal(m.key, w.to_year, card_ids[1], cont_ids[1]);
      signal := s.signal;
      contender_leads_latest := s.contender_leads_latest;
    ELSE
      signal := NULL;
      contender_leads_latest := false;
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('iso3', c.iso3, 'name', c.name,
             'reason', m.unranked_reason) ORDER BY c.name), '[]'::jsonb)
      INTO unranked
      FROM countries c JOIN regions rg ON rg.id = c.region_id
     WHERE (p_region IS NULL OR rg.slug = p_region)
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset(ranking) AS x(country_id integer)
         WHERE x.country_id = c.id);

    -- Region against region (only for Africa as a whole): partial figures are not ranked.
    IF p_region IS NULL THEN
      WITH rv AS (
        SELECT rg.slug, rg.name, rg.sort_order, round(v.value, m.decimals) AS value,
               round(v.median, m.decimals) AS median, round(v.coverage, 3) AS coverage,
               (v.coverage < 0.9 OR v.value IS NULL) AS partial
        FROM vinara_region_values(m.key, w.from_year, w.to_year) v
        JOIN regions rg ON rg.id = v.region_id
      ),
      ranked_regions AS (
        SELECT rv.*,
               CASE WHEN rv.partial THEN NULL ELSE
                 rank() OVER (PARTITION BY rv.partial ORDER BY CASE WHEN m.direction = 'max'
                   THEN -rv.value ELSE rv.value END) END AS rank
        FROM rv
      )
      SELECT jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'value', value,
               'median', median, 'coverage', coverage, 'partial', partial, 'rank', rank)
               ORDER BY sort_order),
             coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'value', value)
               ORDER BY sort_order) FILTER (WHERE rank = 1), '[]'::jsonb),
             coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'value', value)
               ORDER BY sort_order)
               FILTER (WHERE rank = (SELECT min(rr.rank) FROM ranked_regions rr WHERE rr.rank > 1)),
               '[]'::jsonb)
        INTO regions, region_cardinals, region_contenders
        FROM ranked_regions;
    ELSE
      regions := NULL;
      region_cardinals := NULL;
      region_contenders := NULL;
    END IF;

    RETURN NEXT;
  END LOOP;
END
$$;
COMMENT ON FUNCTION vinara_summary(text, integer, integer, text) IS
  'Every metric for Africa or one region: its window, cardinal(s) and silent contender(s) (ties all named), the gap-closing signal, the states taking no part and why, and (for Africa) the regions compared. A metric with no data is left out; p_metric limits it to one metric.';
