-- 0009_dhahabu_charts.sql
-- What the Dhahabu charts, map and country drawer read (milestone 16): the split of a change in
-- the US dollar value of central bank gold into a price effect and a tonnes (volume) effect, used
-- by both the holdings chart and the optional 11th statistics card ("Price effect"), which this
-- migration adds to v_gold_stats. Definitions: docs/dhahabu-stats.md.

-- ── Price effect versus volume effect ────────────────────────────────────────

CREATE FUNCTION gold_price_effect(
  tonnes_from numeric, tonnes_to numeric, price_from numeric, price_to numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT round((price_to - price_from) * troy_oz_per_tonne() * (tonnes_from + tonnes_to) / 2, 2)
$$;

COMMENT ON FUNCTION gold_price_effect(numeric, numeric, numeric, numeric) IS
  'The part of a change in a gold holding''s US dollar value that comes from the price: (price_to − price_from) × troy ounces at the average of the two holdings (US dollars, to the cent). The rest of the change is the volume effect (tonnes bought or sold), taken as the remainder so the two always sum exactly to the change. Averaging the holdings (and so, for the remainder, the prices) makes the split independent of which effect is counted first.';

CREATE FUNCTION gold_holdings_change(
  p_iso3 text[] DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE (
  iso3 text,
  name text,
  from_month date,
  to_month date,
  tonnes_from numeric,
  tonnes_to numeric,
  price_from numeric,
  price_to numeric,
  value_from numeric,
  value_to numeric,
  change_usd numeric,
  price_effect_usd numeric,
  volume_effect_usd numeric
)
LANGUAGE sql STABLE AS $$
WITH window_rows AS (
  SELECT c.iso3::text AS iso3, c.name, r.as_of, r.tonnes, r.value_usd
  FROM gold_official_reserves r JOIN countries c ON c.id = r.country_id
  WHERE (p_iso3 IS NULL OR c.iso3 = ANY (p_iso3))
    AND (p_from IS NULL OR r.as_of >= p_from)
    AND (p_to IS NULL OR r.as_of <= p_to)
),
ranked AS (
  SELECT w.*,
    row_number() OVER (PARTITION BY w.iso3 ORDER BY w.as_of) AS first_rank,
    row_number() OVER (PARTITION BY w.iso3 ORDER BY w.as_of DESC) AS last_rank
  FROM window_rows w
),
priced AS (
  SELECT f.iso3, f.name, f.as_of AS from_month, l.as_of AS to_month,
    f.tonnes AS tonnes_from, l.tonnes AS tonnes_to,
    p0.usd_per_troy_oz AS price_from, p1.usd_per_troy_oz AS price_to,
    f.value_usd AS value_from, l.value_usd AS value_to
  FROM ranked f
  JOIN ranked l ON l.iso3 = f.iso3 AND l.last_rank = 1
  LEFT JOIN gold_price_monthly p0 ON p0.month = date_trunc('month', f.as_of)::date
  LEFT JOIN gold_price_monthly p1 ON p1.month = date_trunc('month', l.as_of)::date
  WHERE f.first_rank = 1 AND f.as_of < l.as_of
)
SELECT p.iso3, p.name, p.from_month, p.to_month, p.tonnes_from, p.tonnes_to,
  p.price_from, p.price_to, p.value_from, p.value_to,
  p.value_to - p.value_from,
  gold_price_effect(p.tonnes_from, p.tonnes_to, p.price_from, p.price_to),
  p.value_to - p.value_from - gold_price_effect(p.tonnes_from, p.tonnes_to, p.price_from, p.price_to)
FROM priced p
ORDER BY p.iso3
$$;

COMMENT ON FUNCTION gold_holdings_change(text[], date, date) IS
  'For each country (all, or those listed) with at least two monthly reports between p_from and p_to: its first and last holding in that window, the month prices, the US dollar values, the change, and the change split into a price effect and a volume effect (gold_price_effect; the two sum exactly to the change). The split is NULL when a month''s price is missing.';

-- ── The statistics band, with the optional 11th card ─────────────────────────

ALTER FUNCTION v_gold_stats(text, integer) RENAME TO gold_stats_core;

COMMENT ON FUNCTION gold_stats_core(text, integer) IS
  'Cards 1–10 of the Dhahabu statistics band (migration 0008); v_gold_stats adds the price effect.';

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
  SELECT c.id, c.iso3 FROM countries c JOIN regions g ON g.id = c.region_id
  WHERE scope_region IS NULL OR g.slug = scope_region
),
-- The countries counted in "Central bank gold held" (same rule as gold_stats_core), with their
-- holding 12 months before their latest report.
latest_holding AS (
  SELECT DISTINCT ON (r.country_id) r.*
  FROM gold_official_reserves r JOIN scope s ON s.id = r.country_id
  WHERE as_of_year IS NULL OR r.as_of <= make_date(as_of_year, 12, 31)
  ORDER BY r.country_id, r.as_of DESC
),
newest_month AS (SELECT max(as_of) AS as_of FROM latest_holding),
pairs AS (
  SELECT h.tonnes AS tonnes_to, h.value_usd AS value_to, prev.tonnes AS tonnes_from,
    prev.value_usd AS value_from, p1.usd_per_troy_oz AS price_to, p0.usd_per_troy_oz AS price_from
  FROM latest_holding h CROSS JOIN newest_month n
  JOIN gold_official_reserves prev
    ON prev.country_id = h.country_id
   AND prev.as_of = (date_trunc('month', h.as_of) - interval '11 months' - interval '1 day')::date
  JOIN gold_price_monthly p1 ON p1.month = date_trunc('month', h.as_of)::date
  JOIN gold_price_monthly p0 ON p0.month = date_trunc('month', prev.as_of)::date
  WHERE h.as_of > (date_trunc('month', n.as_of) - interval '12 months')::date
),
split AS (
  SELECT round(sum(value_to - value_from)) AS change,
    round(sum(gold_price_effect(tonnes_from, tonnes_to, price_from, price_to))) AS price,
    round(sum(value_from)) AS value_from, round(sum(value_to)) AS value_to,
    sum(tonnes_to - tonnes_from) AS tonnes_change,
    count(*)::int AS countries
  FROM pairs HAVING count(*) > 0
)
SELECT * FROM gold_stats_core(scope_region, as_of_year)
UNION ALL
SELECT 'price_effect', 11, 'Price effect (12 months)',
  (SELECT price FROM split), 'USD',
  (SELECT as_of FROM newest_month WHERE EXISTS (SELECT 1 FROM split)),
  jsonb_build_object(
    'changeUsd', (SELECT change FROM split),
    'priceEffectUsd', (SELECT price FROM split),
    'volumeEffectUsd', (SELECT change - price FROM split),
    'valueFromUsd', (SELECT value_from FROM split),
    'valueToUsd', (SELECT value_to FROM split),
    'tonnesChange', (SELECT round(tonnes_change, 3) FROM split),
    'countries', (SELECT countries FROM split)),
  '[]'::jsonb,
  'How much of the 12-month change in the US dollar value of central bank gold came from the gold price, and how much from tonnes bought or sold, for the countries counted in "Central bank gold held" that also reported 12 months earlier. Price effect: the change in the monthly average price × the troy ounces at the average of the two holdings; volume effect: the rest of the change, so the two add up exactly to it. Values are computed at each month''s average price.'
$$;

COMMENT ON FUNCTION v_gold_stats(text, integer) IS
  'The Dhahabu statistics band for All Africa (NULL) or one region, at a reference year (NULL: latest available): gold_stats_core''s ten cards and the price effect. Definitions and tie rules: docs/dhahabu-stats.md.';
