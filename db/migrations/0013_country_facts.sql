-- 0013_country_facts.sql
-- v_country_facts: the facts the countries table and the home map show beside each country's
-- profile: its latest population and land area (each with its own year), its leaders (the
-- executive first) and its next election, whose status is computed from today's date whenever
-- the view is read. Rules: docs/vinara-method.md.

CREATE VIEW v_country_facts AS
SELECT
  c.id AS country_id,
  c.iso3::text AS iso3,
  pop.value AS population,
  pop.year AS population_year,
  (pop.basis = 'estimate') AS population_is_estimate,
  land.value AS land_area_km2,
  land.year AS land_area_year,
  COALESCE(leaders.list, '[]'::json) AS leaders,
  e.decides::text AS election_decides,
  e.kind::text AS election_kind,
  e.next_date AS election_date,
  e.next_precision::text AS election_precision,
  CASE WHEN e.country_id IS NULL THEN NULL ELSE election_status(e.next_date) END
    AS election_status,
  e.note AS politics_note
FROM countries c
LEFT JOIN LATERAL (
  SELECT o.value, o.year, o.basis
  FROM indicator_observations o JOIN indicators i ON i.id = o.indicator_id
  WHERE i.key = 'population' AND o.country_id = c.id
  ORDER BY o.year DESC LIMIT 1
) pop ON true
LEFT JOIN LATERAL (
  SELECT o.value, o.year
  FROM indicator_observations o JOIN indicators i ON i.id = o.indicator_id
  WHERE i.key = 'land_area' AND o.country_id = c.id
  ORDER BY o.year DESC LIMIT 1
) land ON true
LEFT JOIN LATERAL (
  SELECT json_agg(
           json_build_object(
             'role', l.role::text,
             'title', l.title,
             'name', l.person_name,
             'executive', l.is_executive,
             'transitional', l.is_transitional,
             'deFacto', l.is_de_facto
           ) ORDER BY l.position
         ) AS list
  FROM country_leaders l WHERE l.country_id = c.id
) leaders ON true
LEFT JOIN country_elections e ON e.country_id = c.id;

COMMENT ON VIEW v_country_facts IS
  'One row per country: latest population and land area, leaders (executive first) and the next election with its status as of today.';
COMMENT ON COLUMN v_country_facts.country_id IS 'countries.id.';
COMMENT ON COLUMN v_country_facts.iso3 IS 'ISO 3166-1 alpha-3 code.';
COMMENT ON COLUMN v_country_facts.population IS 'Latest population (NULL if none is loaded).';
COMMENT ON COLUMN v_country_facts.population_year IS 'Year of the population figure.';
COMMENT ON COLUMN v_country_facts.population_is_estimate IS 'True when the figure is an IMF estimate.';
COMMENT ON COLUMN v_country_facts.land_area_km2 IS 'Latest land area in square kilometres (excluding inland water).';
COMMENT ON COLUMN v_country_facts.land_area_year IS 'Year of the land area figure.';
COMMENT ON COLUMN v_country_facts.leaders IS
  'JSON array of {role, title, name, executive, transitional, deFacto}, the executive first; empty until leaders are approved and loaded.';
COMMENT ON COLUMN v_country_facts.election_decides IS 'presidential, legislative or none (no national elections); NULL until loaded.';
COMMENT ON COLUMN v_country_facts.election_kind IS 'presidential, legislative or general.';
COMMENT ON COLUMN v_country_facts.election_date IS 'Next election date (a month or year alone: its last day).';
COMMENT ON COLUMN v_country_facts.election_precision IS 'day, month or year.';
COMMENT ON COLUMN v_country_facts.election_status IS 'election_status() as of today: within_12_months, beyond_12_months or no_date_set.';
COMMENT ON COLUMN v_country_facts.politics_note IS 'Context shown with the leaders and election (a disputed term, rival authorities…).';
