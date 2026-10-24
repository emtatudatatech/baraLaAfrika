-- 0016_vinara_speed.sql
-- The same rules as 0015, computed faster: the exchange-rate steps run only for the two currency
-- metrics, and each region step only for the metrics that use it (one-time checks the planner
-- evaluates once, skipping the steps a metric does not need). Results are unchanged.

CREATE OR REPLACE FUNCTION vinara_country_years(p_metric text)
RETURNS TABLE (country_id integer, year integer, value numeric, estimate boolean)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT * FROM vinara_metrics WHERE key = p_metric),
  -- Only the currency metrics read exchange rates (a one-time check, so the rest skip them).
  fx AS (SELECT f.country_id, f.month, f.per_usd FROM v_fx_month f WHERE (SELECT m0.measure LIKE 'fx_%' FROM vinara_metrics m0 WHERE m0.key = p_metric)),
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

CREATE OR REPLACE FUNCTION vinara_country_values(p_metric text, p_from integer, p_to integer)
RETURNS TABLE (country_id integer, value numeric, year integer, years_covered integer, estimate boolean)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT * FROM vinara_metrics WHERE key = p_metric),
  y AS (
    SELECT cy.* FROM vinara_country_years(p_metric) cy WHERE cy.year BETWEEN p_from AND p_to
  ),
  fx AS (
    SELECT f.country_id, f.month, f.per_usd FROM v_fx_month f
    WHERE f.month BETWEEN make_date(p_from, 1, 1) AND make_date(p_to, 12, 1)
      -- Only the currency metrics read exchange rates (a one-time check, so the rest skip them).
      AND (SELECT m0.measure LIKE 'fx_%' FROM vinara_metrics m0 WHERE m0.key = p_metric)
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

CREATE OR REPLACE FUNCTION vinara_region_values(p_metric text, p_from integer, p_to integer)
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
    WHERE (p.value IS NOT NULL OR mb.population IS NOT NULL)
      AND (SELECT m0.regional = 'per_capita' FROM vinara_metrics m0 WHERE m0.key = p_metric)
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
      AND (SELECT m0.regional = 'gdp_weighted' FROM vinara_metrics m0 WHERE m0.key = p_metric)
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
