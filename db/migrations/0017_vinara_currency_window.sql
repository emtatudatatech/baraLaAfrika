-- 0017_vinara_currency_window.sql
-- The currency metrics' default window ends at the latest full calendar year of rates any state
-- has, rather than the last year at least 90% of the states have, so the rankings show the latest
-- rates. States without rates for the window's last month take no part and say so, as before.

CREATE OR REPLACE FUNCTION vinara_window(p_metric text, p_from integer DEFAULT NULL, p_to integer DEFAULT NULL)
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
  -- The currency metrics run to the latest full year of rates any state has (states without
  -- rates for its last month take no part); the others to their last complete year.
  bounds AS (
    SELECT min(year) AS first_year, max(year) AS last_year,
           CASE WHEN (SELECT m.measure LIKE 'fx_%' FROM vinara_metrics m WHERE m.key = p_metric)
             THEN max(year)
             ELSE max(year) FILTER (WHERE n >= 0.9 * (SELECT count(*) FROM countries))
           END AS last_complete
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
  'The years a metric is measured over: by default the last ten complete years (a year is complete when at least 90% of the states have a figure); both currency metrics share one window, ending at the latest full year of rates any state has. Never beyond the data; a given range is kept within the data.';
