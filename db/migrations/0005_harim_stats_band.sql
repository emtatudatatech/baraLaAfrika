-- Migration 0005: the Harim statistics band (milestone 10).
-- * harim_elevation_alternatives(): a mountain's other sourced heights, with source titles, so
--   the band can show "sources disagree" markers from the stats response alone.
-- * v_harim_stats(): mountain entities carry their confidence, review flag and alternatives;
--   the lowest national high point carries its mountain's too, and the lowest point its review
--   flag. The volcanic definition names curated volcanoes (pipeline change after milestone 9).
--   For a region, the lowest point's label names the region ("Lowest point in East Africa"),
--   so a regional figure never reads as Africa's. Values and tie rules are unchanged.

CREATE FUNCTION harim_elevation_alternatives(p_mountain_id integer)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
      'elevationM', (a.item ->> 'm')::integer,
      'source', coalesce(s.title, a.item ->> 'source')) ORDER BY a.ord),
    '[]'::jsonb)
  FROM mountains m
  CROSS JOIN LATERAL jsonb_array_elements(m.elevation_alternatives) WITH ORDINALITY AS a(item, ord)
  LEFT JOIN sources s ON s.source_key = a.item ->> 'source'
  WHERE m.id = p_mountain_id
$$;

COMMENT ON FUNCTION harim_elevation_alternatives(integer) IS
  'A mountain''s other sourced elevations as [{"elevationM", "source" (title)}], in stored order.';

CREATE OR REPLACE FUNCTION v_harim_stats(scope_region text DEFAULT NULL)
RETURNS TABLE (
  key text,
  sort_order integer,
  label text,
  value numeric,
  unit text,
  detail jsonb,
  entities jsonb,
  definition text
)
LANGUAGE sql STABLE AS $$
WITH scope AS (
  SELECT c.id, c.iso3, c.name
  FROM countries c JOIN regions g ON g.id = c.region_id
  WHERE scope_region IS NULL OR g.slug = scope_region
),
-- Counted mountains with at least one country in scope (a shared peak once).
counted AS (
  SELECT v.* FROM v_mountains v
  WHERE v.is_counted
    AND EXISTS (SELECT 1 FROM scope s WHERE s.iso3 = ANY (v.country_iso3s))
),
-- Each (country in scope, counted mountain) pair: for per-country figures.
per_country AS (
  SELECT s.iso3, s.name AS country_name, v.*
  FROM scope s JOIN counted v ON s.iso3 = ANY (v.country_iso3s)
),
summary AS (
  SELECT cs.* FROM v_country_mountain_summary cs JOIN scope s ON s.id = cs.country_id
),
mountain_json AS (
  SELECT v.mountain_id,
    jsonb_build_object(
      'kind', 'mountain', 'slug', v.slug, 'name', v.name, 'elevationM', v.elevation_m,
      'summitName', (SELECT s.name FROM mountains s WHERE s.parent_id = v.mountain_id
                     ORDER BY s.elevation_m DESC, s.name LIMIT 1),
      'countries', to_jsonb(v.country_iso3s), 'confidence', v.elevation_confidence,
      'needsReview', v.needs_review,
      'alternatives', harim_elevation_alternatives(v.mountain_id)) AS item
  FROM counted v
),
tallest AS (
  SELECT jsonb_agg(j.item ORDER BY v.name) AS items, max(v.elevation_m) AS m
  FROM counted v JOIN mountain_json j USING (mountain_id)
  WHERE v.elevation_m = (SELECT max(elevation_m) FROM counted)
),
lowest_high AS (
  SELECT jsonb_agg(jsonb_build_object(
           'kind', 'country', 'iso3', s.iso3, 'name', s.name, 'mountain', s.highest_peak_slug,
           'mountainName', s.highest_peak_name, 'elevationM', s.highest_peak_m,
           'confidence', hv.elevation_confidence, 'needsReview', hv.needs_review,
           'alternatives', harim_elevation_alternatives(hv.mountain_id))
         ORDER BY s.name) AS items,
         min(s.highest_peak_m) AS m
  FROM summary s JOIN v_mountains hv ON hv.slug = s.highest_peak_slug
  WHERE s.highest_peak_m = (SELECT min(highest_peak_m) FROM summary)
),
by_country_3000 AS (
  SELECT iso3, country_name, count(*) AS n FROM per_country
  WHERE elevation_m >= 3000 GROUP BY iso3, country_name
),
most_mountainous AS (
  SELECT jsonb_agg(jsonb_build_object('kind', 'country', 'iso3', iso3, 'name', country_name,
                   'count', n) ORDER BY country_name) AS items, max(n) AS n
  FROM by_country_3000 WHERE n = (SELECT max(n) FROM by_country_3000)
),
by_range_3000 AS (
  SELECT range_slug, range_name, count(*) AS n,
         (array_agg(name ORDER BY elevation_m DESC, name))[1] AS tallest_name,
         (array_agg(slug ORDER BY elevation_m DESC, name))[1] AS tallest_slug,
         max(elevation_m) AS tallest_m
  FROM counted WHERE elevation_m >= 3000 AND range_slug IS NOT NULL
  GROUP BY range_slug, range_name
),
busiest_range AS (
  SELECT jsonb_agg(jsonb_build_object('kind', 'range', 'slug', range_slug, 'name', range_name,
                   'count', n, 'tallest', jsonb_build_object('slug', tallest_slug,
                   'name', tallest_name, 'elevationM', tallest_m)) ORDER BY range_name) AS items,
         max(n) AS n
  FROM by_range_3000 WHERE n = (SELECT max(n) FROM by_range_3000)
),
lowest_point AS (
  SELECT jsonb_agg(jsonb_build_object('kind', 'country', 'iso3', s.iso3, 'name', s.name,
                   'pointName', s.lowest_point_name, 'elevationM', s.lowest_point_m,
                   'feature', s.lowest_point_feature,
                   'needsReview', s.lowest_point_needs_review) ORDER BY s.name) AS items,
         min(s.lowest_point_m) AS m
  FROM summary s WHERE s.lowest_point_m = (SELECT min(lowest_point_m) FROM summary)
),
relief AS (
  SELECT jsonb_agg(jsonb_build_object('kind', 'country', 'iso3', s.iso3, 'name', s.name,
                   'highestM', s.highest_peak_m, 'highestName', s.highest_peak_name,
                   'lowestM', s.lowest_point_m, 'lowestName', s.lowest_point_name)
                   ORDER BY s.name) AS items,
         max(s.relief_m) AS m
  FROM summary s WHERE s.relief_m = (SELECT max(relief_m) FROM summary)
),
prominent AS (
  SELECT
    (SELECT count(*) FROM counted WHERE elevation_m >= 3000) AS above_3000,
    (SELECT count(*) FROM counted WHERE elevation_m >= 3000 AND prominence_m IS NOT NULL)
      AS with_prominence,
    (SELECT max(prominence_m) FROM counted) AS m
),
most_prominent AS (
  SELECT jsonb_agg(j.item || jsonb_build_object('prominenceM', v.prominence_m) ORDER BY v.name)
           AS items
  FROM counted v JOIN mountain_json j USING (mountain_id)
  WHERE v.prominence_m = (SELECT m FROM prominent)
)
SELECT * FROM (
  SELECT 'mountains_catalogued', 1, 'Mountains catalogued',
    (SELECT count(*) FROM counted)::numeric, 'mountains',
    jsonb_build_object(
      'countries', (SELECT count(DISTINCT iso3) FROM per_country),
      'territoryPeaks', CASE WHEN scope_region IS NULL
        THEN (SELECT count(*) FROM v_mountains WHERE territory_name IS NOT NULL
              AND summit_kind <> 'summit') ELSE 0 END),
    '[]'::jsonb,
    'The number of mountains in this curated catalogue: every national high point, every peak of 3,000 m or more, and notable further peaks. It is not a count of all of Africa''s mountains. A massif counts once (its summits are parts of it), a peak on a border counts once, and peaks in territories outside the 54 countries are not included.'
  UNION ALL
  SELECT 'volcanic_mountains', 2, 'Volcanic mountains',
    (SELECT count(*) FROM counted WHERE is_volcanic)::numeric, 'mountains',
    jsonb_build_object(
      'active', (SELECT count(*) FROM counted WHERE is_volcanic AND volcanic_status = 'active'),
      'dormant', (SELECT count(*) FROM counted WHERE is_volcanic AND volcanic_status = 'dormant'),
      'extinct', (SELECT count(*) FROM counted WHERE is_volcanic AND volcanic_status = 'extinct'),
      'unknown', (SELECT count(*) FROM counted WHERE is_volcanic AND volcanic_status IS NULL)),
    '[]'::jsonb,
    'Catalogued mountains that are volcanoes by type (stratovolcano, shield volcano or other volcano: from Wikidata, because the Smithsonian Global Volcanism Program lists them, or from a curated, quoted source) or have a stated volcanic status. Status (active, dormant, extinct) is shown only where a source states it; the rest are counted as unknown.'
  UNION ALL
  SELECT 'tallest_mountain', 3, 'Tallest mountain', (SELECT m FROM tallest), 'm',
    '{}'::jsonb, coalesce((SELECT items FROM tallest), '[]'::jsonb),
    'The catalogued mountain with the greatest elevation. For a massif, its highest summit is named too. Ties are all listed.'
  UNION ALL
  SELECT 'lowest_national_high_point', 4, 'Lowest national high point', (SELECT m FROM lowest_high), 'm',
    '{}'::jsonb, coalesce((SELECT items FROM lowest_high), '[]'::jsonb),
    'Africa''s lowest "highest point": the lowest of the countries'' highest points. It is not "the shortest mountain": the catalogue leaves out small hills, and some national high points are hills or flat ground rather than mountains. Ties are all listed.'
  UNION ALL
  SELECT 'peaks_above_4000', 5, 'Peaks above 4,000 m',
    (SELECT count(*) FROM counted WHERE elevation_m > 4000)::numeric, 'mountains',
    jsonb_build_object(
      'above5000', (SELECT count(*) FROM counted WHERE elevation_m > 5000),
      'from4000to5000', (SELECT count(*) FROM counted WHERE elevation_m > 4000 AND elevation_m <= 5000),
      'from3000to4000', (SELECT count(*) FROM counted WHERE elevation_m > 3000 AND elevation_m <= 4000),
      'upTo3000', (SELECT count(*) FROM counted WHERE elevation_m <= 3000)),
    '[]'::jsonb,
    'Catalogued mountains higher than 4,000 m. The bands are: above 5,000 m; above 4,000 m up to 5,000 m; above 3,000 m up to 4,000 m; and 3,000 m or lower.'
  UNION ALL
  SELECT 'most_mountainous_country', 6, 'Most mountainous country', (SELECT n FROM most_mountainous), 'mountains',
    '{}'::jsonb, coalesce((SELECT items FROM most_mountainous), '[]'::jsonb),
    'The country with the most catalogued mountains of 3,000 m or higher. The catalogue includes every such peak, so this does not depend on how many smaller peaks were chosen. A peak on a border counts for each country it lies in. Ties are all listed.'
  UNION ALL
  SELECT 'busiest_range', 7, 'Busiest range', (SELECT n FROM busiest_range), 'mountains',
    '{}'::jsonb, coalesce((SELECT items FROM busiest_range), '[]'::jsonb),
    'The range with the most catalogued mountains of 3,000 m or higher, with its tallest peak. Ties are all listed.'
  UNION ALL
  SELECT 'lowest_point', 8,
    CASE WHEN scope_region IS NULL THEN 'Lowest point in Africa'
      ELSE 'Lowest point in ' || (SELECT name FROM regions WHERE slug = scope_region) END,
    (SELECT m FROM lowest_point), 'm',
    '{}'::jsonb, coalesce((SELECT items FROM lowest_point), '[]'::jsonb),
    'The lowest of the countries'' lowest points; negative values are below sea level. Ties are all listed.'
  UNION ALL
  SELECT 'greatest_relief', 9, 'Greatest relief', (SELECT m FROM relief), 'm',
    '{}'::jsonb, coalesce((SELECT items FROM relief), '[]'::jsonb),
    'The country with the largest difference between its highest and lowest points. Ties are all listed.'
  UNION ALL
  SELECT 'most_prominent_peak', 10, 'Most prominent peak',
    CASE WHEN p.above_3000 > 0 AND p.with_prominence::numeric / p.above_3000 >= 0.8 THEN p.m END, 'm',
    jsonb_build_object(
      'available', p.above_3000 > 0 AND p.with_prominence::numeric / p.above_3000 >= 0.8,
      'coverage', CASE WHEN p.above_3000 > 0 THEN round(p.with_prominence::numeric / p.above_3000, 3) END),
    CASE WHEN p.above_3000 > 0 AND p.with_prominence::numeric / p.above_3000 >= 0.8
      THEN coalesce((SELECT items FROM most_prominent), '[]'::jsonb) ELSE '[]'::jsonb END,
    'The catalogued mountain with the greatest topographic prominence. Shown only when prominence is known for at least 80% of the catalogued mountains of 3,000 m or higher. Ties are all listed.'
  FROM prominent p
) AS stats (key, sort_order, label, value, unit, detail, entities, definition)
ORDER BY sort_order;
$$;

COMMENT ON FUNCTION v_harim_stats(text) IS
  'The Harim summary statistics for all of Africa (NULL) or one region: one row per card with its value, details, entities (ties listed) and the definition shown to users. See docs/harim-stats.md.';
