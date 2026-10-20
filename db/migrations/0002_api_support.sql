-- 0002_api_support.sql
-- Read-side helpers for the API: accent-insensitive search and the country summary view.

-- ── Accent-insensitive search ────────────────────────────────────────────────

CREATE FUNCTION search_fold(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT regexp_replace(normalize(lower(value), NFD), U&'[\0300-\036F]', '', 'g')
$$;
COMMENT ON FUNCTION search_fold(text) IS
  'Lower-cases text and strips combining accents (NFD), so "cote" matches "Côte d''Ivoire".';

-- ── Country summary view ─────────────────────────────────────────────────────

CREATE VIEW v_country_summary AS
SELECT
  c.id                         AS country_id,
  c.iso3::text                 AS iso3,
  c.iso2::text                 AS iso2,
  c.name,
  c.official_name,
  r.slug                       AS region_slug,
  r.name                       AS region_name,
  r.color_hex                  AS region_color_hex,
  r.sort_order                 AS region_sort_order,
  c.flag_url_template,
  c.centroid_lon,
  c.centroid_lat,
  c.is_microstate_marker,
  p.etymology_summary,
  p.etymology_category::text   AS etymology_category,
  p.flag_design_summary,
  p.flag_design_detail,
  p.national_symbol_summary,
  p.national_animal_name,
  p.animal_status::text        AS animal_status,
  p.needs_review,
  search_fold(concat_ws(' ', c.name, c.official_name, c.iso2, c.iso3)) AS search_text
FROM countries c
JOIN regions r ON r.id = c.region_id
JOIN country_profiles p ON p.country_id = c.id;

COMMENT ON VIEW v_country_summary IS
  'One row per country with its region and the short profile fields used by the countries list and map.';
COMMENT ON COLUMN v_country_summary.country_id IS 'countries.id.';
COMMENT ON COLUMN v_country_summary.iso3 IS 'ISO 3166-1 alpha-3 code.';
COMMENT ON COLUMN v_country_summary.iso2 IS 'ISO 3166-1 alpha-2 code.';
COMMENT ON COLUMN v_country_summary.name IS 'Common name.';
COMMENT ON COLUMN v_country_summary.official_name IS 'Formal state name.';
COMMENT ON COLUMN v_country_summary.region_slug IS 'Region slug.';
COMMENT ON COLUMN v_country_summary.region_name IS 'Region display name.';
COMMENT ON COLUMN v_country_summary.region_color_hex IS 'Approved region colour (NULL until approved).';
COMMENT ON COLUMN v_country_summary.region_sort_order IS 'Region display order.';
COMMENT ON COLUMN v_country_summary.flag_url_template IS 'Flagpedia PNG URL with a {width} placeholder.';
COMMENT ON COLUMN v_country_summary.centroid_lon IS 'Label/marker longitude.';
COMMENT ON COLUMN v_country_summary.centroid_lat IS 'Label/marker latitude.';
COMMENT ON COLUMN v_country_summary.is_microstate_marker IS 'Whether the map draws a circle marker.';
COMMENT ON COLUMN v_country_summary.etymology_summary IS 'Short meaning of the name.';
COMMENT ON COLUMN v_country_summary.etymology_category IS 'Reviewed origin category, or NULL.';
COMMENT ON COLUMN v_country_summary.flag_design_summary IS 'Short flag description (tooltip).';
COMMENT ON COLUMN v_country_summary.flag_design_detail IS 'Prose flag description (tooltip, second part).';
COMMENT ON COLUMN v_country_summary.national_symbol_summary IS 'Short national symbol description.';
COMMENT ON COLUMN v_country_summary.national_animal_name IS 'National animal(s).';
COMMENT ON COLUMN v_country_summary.animal_status IS 'Basis for the national animal.';
COMMENT ON COLUMN v_country_summary.needs_review IS 'Whether the record still needs verification.';
COMMENT ON COLUMN v_country_summary.search_text IS 'Accent-folded name, official name and ISO codes for search.';
