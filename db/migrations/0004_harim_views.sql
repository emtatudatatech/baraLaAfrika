-- 0004_harim_views.sql
-- Read models for the Harim API: every mountain with its countries and range, the per-country
-- summary table, and the summary statistics. Definitions live here, once (docs/harim-stats.md
-- explains each statistic and its tie rule; a test keeps the two in step).
--
-- Counting rule (as in 0003): a mountain counts once when it is `standalone` or a `massif` and
-- not a territory peak; summits are parts of their massif; a shared peak counts once.

-- ── Every mountain, with what the API lists ──────────────────────────────────

CREATE VIEW v_mountains AS
SELECT
  m.id AS mountain_id,
  m.slug,
  m.name,
  m.alt_names,
  m.elevation_m,
  m.elevation_confidence,
  m.latitude,
  m.longitude,
  m.peak_type,
  m.volcanic_status,
  (m.peak_type IN ('stratovolcano', 'shield_volcano', 'volcano') OR m.volcanic_status IS NOT NULL)
    AS is_volcanic,
  m.prominence_m,
  m.isolation_km,
  m.summit_kind,
  p.slug AS parent_slug,
  p.name AS parent_name,
  r.slug AS range_slug,
  r.name AS range_name,
  m.territory_name,
  m.needs_review,
  (m.summit_kind <> 'summit' AND m.territory_name IS NULL) AS is_counted,
  coalesce(array_agg(c.iso3 ORDER BY c.iso3) FILTER (WHERE c.iso3 IS NOT NULL), '{}') AS country_iso3s,
  coalesce(array_agg(c.iso3 ORDER BY c.iso3) FILTER (WHERE mc.is_country_high_point), '{}')
    AS high_point_of,
  coalesce(array_agg(DISTINCT g.slug) FILTER (WHERE g.slug IS NOT NULL), '{}') AS region_slugs,
  count(c.id) > 1 AS is_shared,
  search_fold(concat_ws(' ', m.name, array_to_string(m.alt_names, ' '), p.name, r.name,
    m.territory_name, string_agg(c.name, ' '))) AS search_text
FROM mountains m
LEFT JOIN mountains p ON p.id = m.parent_id
LEFT JOIN mountain_ranges r ON r.id = m.range_id
LEFT JOIN mountain_countries mc ON mc.mountain_id = m.id
LEFT JOIN countries c ON c.id = mc.country_id
LEFT JOIN regions g ON g.id = c.region_id
GROUP BY m.id, p.slug, p.name, r.slug, r.name;

COMMENT ON VIEW v_mountains IS
  'Every mountain (including summits and territory peaks) with its countries, regions, parent and range; is_counted marks the mountains that statistics count.';
COMMENT ON COLUMN v_mountains.mountain_id IS 'mountains.id.';
COMMENT ON COLUMN v_mountains.slug IS 'URL key.';
COMMENT ON COLUMN v_mountains.name IS 'Display name.';
COMMENT ON COLUMN v_mountains.alt_names IS 'Other names.';
COMMENT ON COLUMN v_mountains.elevation_m IS 'Chosen elevation in metres.';
COMMENT ON COLUMN v_mountains.elevation_confidence IS 'high, medium or low.';
COMMENT ON COLUMN v_mountains.latitude IS 'Summit latitude.';
COMMENT ON COLUMN v_mountains.longitude IS 'Summit longitude.';
COMMENT ON COLUMN v_mountains.peak_type IS 'Landform type.';
COMMENT ON COLUMN v_mountains.volcanic_status IS 'active, dormant or extinct where a source states it.';
COMMENT ON COLUMN v_mountains.is_volcanic IS 'A volcano by type, or with a stated volcanic status.';
COMMENT ON COLUMN v_mountains.prominence_m IS 'Topographic prominence in metres, where known.';
COMMENT ON COLUMN v_mountains.isolation_km IS 'Topographic isolation in kilometres, where known.';
COMMENT ON COLUMN v_mountains.summit_kind IS 'standalone, massif or summit.';
COMMENT ON COLUMN v_mountains.parent_slug IS 'For a summit, its massif''s slug.';
COMMENT ON COLUMN v_mountains.parent_name IS 'For a summit, its massif''s name.';
COMMENT ON COLUMN v_mountains.range_slug IS 'The range''s slug, if any.';
COMMENT ON COLUMN v_mountains.range_name IS 'The range''s name, if any.';
COMMENT ON COLUMN v_mountains.territory_name IS 'For peaks outside the 54 countries, the territory.';
COMMENT ON COLUMN v_mountains.needs_review IS 'True when sources disagree or a fact is unsourced.';
COMMENT ON COLUMN v_mountains.is_counted IS 'True for mountains that statistics count (standalone or massif, not a territory peak).';
COMMENT ON COLUMN v_mountains.country_iso3s IS 'The countries the mountain lies in (empty for territory peaks).';
COMMENT ON COLUMN v_mountains.high_point_of IS 'The countries whose highest point it is.';
COMMENT ON COLUMN v_mountains.region_slugs IS 'The regions of its countries.';
COMMENT ON COLUMN v_mountains.is_shared IS 'True when it lies in more than one country.';
COMMENT ON COLUMN v_mountains.search_text IS 'Accent-folded names, range, territory and countries for search.';

-- ── One row per country ──────────────────────────────────────────────────────

CREATE VIEW v_country_mountain_summary AS
WITH counted AS (
  SELECT mc.country_id, mc.is_country_high_point, v.*
  FROM mountain_countries mc
  JOIN v_mountains v ON v.mountain_id = mc.mountain_id
  WHERE v.is_counted
),
high AS (
  SELECT country_id, mountain_id, slug, name, elevation_m, elevation_confidence, is_shared,
         needs_review, country_iso3s
  FROM counted WHERE is_country_high_point
),
ranges AS (
  SELECT country_id, array_agg(range_name ORDER BY peaks DESC, range_name) AS range_names
  FROM (
    SELECT country_id, range_name, count(*) AS peaks
    FROM counted WHERE range_name IS NOT NULL
    GROUP BY country_id, range_name
  ) per_range
  GROUP BY country_id
)
SELECT
  c.id AS country_id,
  c.iso3,
  c.iso2,
  c.name,
  g.slug AS region_slug,
  g.name AS region_name,
  g.color_hex AS region_color_hex,
  c.flag_url_template,
  h.slug AS highest_peak_slug,
  h.name AS highest_peak_name,
  (SELECT s.name FROM mountains s WHERE s.parent_id = h.mountain_id
   ORDER BY s.elevation_m DESC, s.name LIMIT 1) AS highest_summit_name,
  h.elevation_m AS highest_peak_m,
  h.elevation_confidence AS highest_peak_confidence,
  coalesce(h.is_shared, false) AS high_point_shared,
  coalesce(array_remove(h.country_iso3s, c.iso3), '{}') AS high_point_shared_with,
  coalesce(h.needs_review, false) AS high_point_needs_review,
  (SELECT count(*)::int FROM counted k WHERE k.country_id = c.id) AS peak_count,
  (SELECT round(avg(k.elevation_m))::int FROM counted k WHERE k.country_id = c.id) AS mean_peak_m,
  coalesce(rg.range_names, '{}') AS range_names,
  lp.name AS lowest_point_name,
  lp.elevation_m AS lowest_point_m,
  lp.feature_type AS lowest_point_feature,
  lp.needs_review AS lowest_point_needs_review,
  h.elevation_m - lp.elevation_m AS relief_m,
  search_fold(concat_ws(' ', c.name, c.official_name, c.iso2, c.iso3, h.name,
    array_to_string(rg.range_names, ' '))) AS search_text
FROM countries c
JOIN regions g ON g.id = c.region_id
LEFT JOIN high h ON h.country_id = c.id
LEFT JOIN ranges rg ON rg.country_id = c.id
LEFT JOIN country_low_points lp ON lp.country_id = c.id;

COMMENT ON VIEW v_country_mountain_summary IS
  'One row per country for the Harim summary table: highest peak, peak count, mean height, ranges, lowest point and relief (counting rule applied).';
COMMENT ON COLUMN v_country_mountain_summary.country_id IS 'countries.id.';
COMMENT ON COLUMN v_country_mountain_summary.iso3 IS 'ISO 3166-1 alpha-3.';
COMMENT ON COLUMN v_country_mountain_summary.iso2 IS 'ISO 3166-1 alpha-2.';
COMMENT ON COLUMN v_country_mountain_summary.name IS 'Country name.';
COMMENT ON COLUMN v_country_mountain_summary.region_slug IS 'Region slug.';
COMMENT ON COLUMN v_country_mountain_summary.region_name IS 'Region name.';
COMMENT ON COLUMN v_country_mountain_summary.region_color_hex IS 'Approved region colour.';
COMMENT ON COLUMN v_country_mountain_summary.flag_url_template IS 'Flagpedia PNG template.';
COMMENT ON COLUMN v_country_mountain_summary.highest_peak_slug IS 'The country''s high point (a mountain, never a summit).';
COMMENT ON COLUMN v_country_mountain_summary.highest_peak_name IS 'Its name.';
COMMENT ON COLUMN v_country_mountain_summary.highest_summit_name IS 'For a massif, its highest summit (e.g. Kibo for Kilimanjaro).';
COMMENT ON COLUMN v_country_mountain_summary.highest_peak_m IS 'Its elevation in metres.';
COMMENT ON COLUMN v_country_mountain_summary.highest_peak_confidence IS 'Its elevation confidence.';
COMMENT ON COLUMN v_country_mountain_summary.high_point_shared IS 'True when the high point lies on a border.';
COMMENT ON COLUMN v_country_mountain_summary.high_point_shared_with IS 'The other countries sharing it.';
COMMENT ON COLUMN v_country_mountain_summary.high_point_needs_review IS 'True when the high point needs review.';
COMMENT ON COLUMN v_country_mountain_summary.peak_count IS 'Catalogued mountains in the country (counting rule; shared peaks included).';
COMMENT ON COLUMN v_country_mountain_summary.mean_peak_m IS 'Mean elevation of those mountains, rounded.';
COMMENT ON COLUMN v_country_mountain_summary.range_names IS 'Ranges of those mountains, most peaks first.';
COMMENT ON COLUMN v_country_mountain_summary.lowest_point_name IS 'The country''s lowest point.';
COMMENT ON COLUMN v_country_mountain_summary.lowest_point_m IS 'Its elevation (negative = below sea level).';
COMMENT ON COLUMN v_country_mountain_summary.lowest_point_feature IS 'depression, lake, river, salt flat, coast or other.';
COMMENT ON COLUMN v_country_mountain_summary.lowest_point_needs_review IS 'True when the low point needs review.';
COMMENT ON COLUMN v_country_mountain_summary.relief_m IS 'Highest minus lowest point, in metres.';
COMMENT ON COLUMN v_country_mountain_summary.search_text IS 'Accent-folded names and ranges for search.';

-- ── Summary statistics (the cards at the top of /harim) ──────────────────────

CREATE FUNCTION v_harim_stats(scope_region text DEFAULT NULL)
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
      'needsReview', v.needs_review) AS item
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
           'mountainName', s.highest_peak_name, 'elevationM', s.highest_peak_m)
         ORDER BY s.name) AS items,
         min(s.highest_peak_m) AS m
  FROM summary s
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
                   'feature', s.lowest_point_feature) ORDER BY s.name) AS items,
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
    'Catalogued mountains that are volcanoes by type (stratovolcano, shield volcano or other volcano, from Wikidata or because the Smithsonian Global Volcanism Program lists them) or have a stated volcanic status. Status (active, dormant, extinct) is shown only where a source states it; the rest are counted as unknown.'
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
  SELECT 'lowest_point', 8, 'Lowest point in Africa', (SELECT m FROM lowest_point), 'm',
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
