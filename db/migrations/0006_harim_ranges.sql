-- Migration 0006: the Harim ranges view (milestone 12).
-- v_range_summary: one row per curated range with its counted mountains (a massif once, a peak
-- on a border once), tallest peak, heights for the mini bar, the countries it spans (most peaks
-- first), the regions it touches, and the region whose colour tints its card: the region of the
-- country with the most of its peaks, or NULL when the leading countries lie in different
-- regions ("split").

CREATE VIEW v_range_summary AS
WITH member AS (
  SELECT v.range_slug, v.slug, v.name, v.elevation_m, v.country_iso3s
  FROM v_mountains v
  WHERE v.is_counted AND v.range_slug IS NOT NULL
),
per_country AS (
  SELECT m.range_slug, c.iso3, g.slug AS region_slug, count(*) AS n
  FROM member m
  JOIN countries c ON c.iso3 = ANY (m.country_iso3s)
  JOIN regions g ON g.id = c.region_id
  GROUP BY m.range_slug, c.iso3, g.slug
),
top_countries AS (
  SELECT p.range_slug, array_agg(DISTINCT p.region_slug) AS regions
  FROM per_country p
  WHERE p.n = (SELECT max(q.n) FROM per_country q WHERE q.range_slug = p.range_slug)
  GROUP BY p.range_slug
)
SELECT
  r.id AS range_id,
  r.slug,
  r.name,
  r.range_type,
  r.description,
  r.length_km,
  r.formation_note,
  r.source_id,
  r.wikidata_qid,
  r.needs_review,
  r.review_notes,
  count(m.slug)::int AS peak_count,
  (array_agg(m.slug ORDER BY m.elevation_m DESC, m.name) FILTER (WHERE m.slug IS NOT NULL))[1]
    AS tallest_slug,
  (array_agg(m.name ORDER BY m.elevation_m DESC, m.name) FILTER (WHERE m.slug IS NOT NULL))[1]
    AS tallest_name,
  max(m.elevation_m) AS tallest_m,
  coalesce(array_agg(m.elevation_m ORDER BY m.elevation_m DESC) FILTER (WHERE m.slug IS NOT NULL),
    '{}') AS heights,
  coalesce((SELECT array_agg(p.iso3 ORDER BY p.n DESC, p.iso3)
            FROM per_country p WHERE p.range_slug = r.slug), '{}') AS country_iso3s,
  coalesce((SELECT array_agg(DISTINCT p.region_slug)
            FROM per_country p WHERE p.range_slug = r.slug), '{}') AS region_slugs,
  (SELECT CASE WHEN cardinality(l.regions) = 1 THEN l.regions[1] END
   FROM top_countries l WHERE l.range_slug = r.slug) AS tint_region,
  search_fold(concat_ws(' ', r.name, string_agg(m.name, ' '))) AS search_text
FROM mountain_ranges r
LEFT JOIN member m ON m.range_slug = r.slug
GROUP BY r.id;

COMMENT ON VIEW v_range_summary IS
  'Harim ranges with their counted mountains: tallest peak, heights, countries (most peaks first), regions and the card tint. Read by /api/mountains/ranges.';
COMMENT ON COLUMN v_range_summary.peak_count IS 'Counted mountains in the range (a massif once, a border peak once).';
COMMENT ON COLUMN v_range_summary.heights IS 'Elevations of its mountains in metres, highest first (the card''s mini bar).';
COMMENT ON COLUMN v_range_summary.country_iso3s IS 'Countries it spans, those with the most of its peaks first.';
COMMENT ON COLUMN v_range_summary.region_slugs IS 'Regions of those countries (for the region filter).';
COMMENT ON COLUMN v_range_summary.tint_region IS 'Region of the country with the most of its peaks; NULL when the leading countries are in different regions.';
COMMENT ON COLUMN v_range_summary.search_text IS 'Accent-folded range and mountain names for search.';
COMMENT ON COLUMN v_range_summary.range_id IS 'mountain_ranges.id.';
COMMENT ON COLUMN v_range_summary.slug IS 'URL key, e.g. "rwenzori".';
COMMENT ON COLUMN v_range_summary.name IS 'Display name.';
COMMENT ON COLUMN v_range_summary.range_type IS 'How the range formed, where a source states it.';
COMMENT ON COLUMN v_range_summary.description IS 'Short sourced description.';
COMMENT ON COLUMN v_range_summary.length_km IS 'Length in kilometres, where a source gives it.';
COMMENT ON COLUMN v_range_summary.formation_note IS 'Short sourced note on how the range formed.';
COMMENT ON COLUMN v_range_summary.source_id IS 'Source for the description, length and formation note.';
COMMENT ON COLUMN v_range_summary.wikidata_qid IS 'Wikidata item.';
COMMENT ON COLUMN v_range_summary.needs_review IS 'True when any text is unsourced or uncertain.';
COMMENT ON COLUMN v_range_summary.review_notes IS 'Why the range needs review.';
COMMENT ON COLUMN v_range_summary.tallest_slug IS 'Its tallest mountain (ties broken by name).';
COMMENT ON COLUMN v_range_summary.tallest_name IS 'That mountain''s name.';
COMMENT ON COLUMN v_range_summary.tallest_m IS 'That mountain''s elevation in metres.';
