-- 0003_harim.sql
-- Harim (mountains): ranges, mountains with a two-level massif → summit hierarchy, the
-- countries each mountain lies in (border peaks belong to several), their sources, and each
-- country's lowest point.
--
-- Counting rule used everywhere: a "mountain" is a `standalone` or `massif` row; `summit` rows
-- are parts of a massif and never count as separate mountains. A peak shared between countries
-- counts once. Territory peaks (territory_name set) are not in any of the 54 countries and are
-- counted separately.

-- ── Enumerations ─────────────────────────────────────────────────────────────

CREATE TYPE range_type AS ENUM (
  'volcanic', 'fold', 'rift_shoulder', 'massif', 'plateau_escarpment', 'other'
);
COMMENT ON TYPE range_type IS 'How a mountain range formed.';

CREATE TYPE peak_type AS ENUM (
  'stratovolcano', 'shield_volcano', 'volcano', 'massif', 'peak', 'other'
);
COMMENT ON TYPE peak_type IS 'The kind of landform a mountain is.';

CREATE TYPE volcanic_status AS ENUM ('active', 'dormant', 'extinct');
COMMENT ON TYPE volcanic_status IS 'A volcano''s status, only where a source states it.';

CREATE TYPE summit_kind AS ENUM ('standalone', 'massif', 'summit');
COMMENT ON TYPE summit_kind IS
  'standalone: a single mountain; massif: a mountain made of several summits; summit: one summit of a massif (never counted as a separate mountain).';

CREATE TYPE confidence_level AS ENUM ('high', 'medium', 'low');
COMMENT ON TYPE confidence_level IS 'How far a value can be trusted, from how well its sources agree.';

CREATE TYPE low_point_feature AS ENUM ('depression', 'lake', 'river', 'salt_flat', 'coast', 'other');
COMMENT ON TYPE low_point_feature IS
  'The kind of place a country''s lowest point is (coast = sea level on the coast).';

CREATE TYPE mountain_field AS ENUM (
  'identity', 'elevation', 'coordinates', 'prominence', 'range', 'hierarchy',
  'volcanic_status', 'local_names', 'name_origin'
);
COMMENT ON TYPE mountain_field IS 'A fact about a mountain that a source can support.';

-- ── mountain_ranges ──────────────────────────────────────────────────────────

CREATE TABLE mountain_ranges (
  id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name           text NOT NULL CHECK (btrim(name) <> ''),
  range_type     range_type,
  description    text,
  length_km      numeric(7, 1) CHECK (length_km > 0),
  formation_note text,
  source_id      integer REFERENCES sources (id),
  wikidata_qid   text UNIQUE CHECK (wikidata_qid ~ '^Q[0-9]+$'),
  needs_review   boolean NOT NULL DEFAULT false,
  review_notes   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Descriptive text must be sourced, or flagged for review.
  CHECK (source_id IS NOT NULL OR needs_review OR (description IS NULL AND formation_note IS NULL))
);
CREATE TRIGGER mountain_ranges_set_updated_at BEFORE UPDATE ON mountain_ranges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE mountain_ranges IS 'Mountain ranges that catalogue peaks belong to (Atlas, Rwenzori, Virunga…).';
COMMENT ON COLUMN mountain_ranges.id IS 'Surrogate key.';
COMMENT ON COLUMN mountain_ranges.slug IS 'URL key, e.g. "rwenzori".';
COMMENT ON COLUMN mountain_ranges.name IS 'Display name.';
COMMENT ON COLUMN mountain_ranges.range_type IS 'How the range formed; NULL when no source states it.';
COMMENT ON COLUMN mountain_ranges.description IS 'Short sourced description.';
COMMENT ON COLUMN mountain_ranges.length_km IS 'Length in kilometres, where a source gives it.';
COMMENT ON COLUMN mountain_ranges.formation_note IS 'Short sourced note on how the range formed.';
COMMENT ON COLUMN mountain_ranges.source_id IS 'Source for the description, length and formation note.';
COMMENT ON COLUMN mountain_ranges.wikidata_qid IS 'Wikidata item, e.g. Q160418.';
COMMENT ON COLUMN mountain_ranges.needs_review IS 'True when any text here is unsourced or uncertain.';
COMMENT ON COLUMN mountain_ranges.review_notes IS 'Why the range needs review.';
COMMENT ON COLUMN mountain_ranges.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN mountain_ranges.updated_at IS 'When the row last changed.';

-- ── mountains ────────────────────────────────────────────────────────────────

CREATE TABLE mountains (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                   text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name                   text NOT NULL CHECK (btrim(name) <> ''),
  alt_names              text[] NOT NULL DEFAULT '{}',
  range_id               smallint REFERENCES mountain_ranges (id),
  elevation_m            integer NOT NULL CHECK (elevation_m BETWEEN 0 AND 6000),
  elevation_source_id    integer NOT NULL REFERENCES sources (id),
  elevation_confidence   confidence_level NOT NULL,
  elevation_alternatives jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(elevation_alternatives) = 'array'),
  latitude               double precision NOT NULL CHECK (latitude BETWEEN -47 AND 38),
  longitude              double precision NOT NULL CHECK (longitude BETWEEN -26 AND 64),
  peak_type              peak_type,
  volcanic_status        volcanic_status,
  prominence_m           integer CHECK (prominence_m BETWEEN 0 AND 6000),
  isolation_km           numeric(8, 2) CHECK (isolation_km >= 0),
  summit_kind            summit_kind NOT NULL DEFAULT 'standalone',
  parent_id              integer REFERENCES mountains (id),
  local_names            jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(local_names) = 'array'),
  name_origin            text,
  name_origin_source_id  integer REFERENCES sources (id),
  notes                  text,
  wikidata_qid           text UNIQUE CHECK (wikidata_qid ~ '^Q[0-9]+$'),
  geonames_id            bigint CHECK (geonames_id > 0),
  territory_name         text CHECK (territory_name IS NULL OR btrim(territory_name) <> ''),
  needs_review           boolean NOT NULL DEFAULT false,
  review_notes           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- Exactly the summits have a parent (a massif; checked by trigger). Massifs and standalone
  -- mountains have none, so the hierarchy has two levels and no cycles.
  CHECK ((summit_kind = 'summit') = (parent_id IS NOT NULL)),
  CHECK (parent_id IS DISTINCT FROM id),
  -- A name origin is shown only with its source, or flagged for review.
  CHECK (name_origin IS NULL OR name_origin_source_id IS NOT NULL OR needs_review)
);
CREATE INDEX mountains_parent_id_idx ON mountains (parent_id);
CREATE INDEX mountains_range_id_idx ON mountains (range_id);
CREATE INDEX mountains_elevation_idx ON mountains (elevation_m DESC);
CREATE TRIGGER mountains_set_updated_at BEFORE UPDATE ON mountains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE mountains IS
  'The curated mountain catalogue: every country high point, every peak of 3,000 m or more and notable further peaks; massifs, their summits and territory peaks.';
COMMENT ON COLUMN mountains.id IS 'Surrogate key.';
COMMENT ON COLUMN mountains.slug IS 'URL key, e.g. "kilimanjaro".';
COMMENT ON COLUMN mountains.name IS 'Display name.';
COMMENT ON COLUMN mountains.alt_names IS 'Other names (spellings, older names).';
COMMENT ON COLUMN mountains.range_id IS 'The range the mountain belongs to, if any.';
COMMENT ON COLUMN mountains.elevation_m IS 'The chosen elevation in metres (a massif''s equals its highest summit''s).';
COMMENT ON COLUMN mountains.elevation_source_id IS 'Source of the chosen elevation.';
COMMENT ON COLUMN mountains.elevation_confidence IS 'high: sources agree within 10 m; medium: within 50 m; low: more than 50 m apart, or a single weak source.';
COMMENT ON COLUMN mountains.elevation_alternatives IS 'Other sourced values: [{"m": 4566, "source": "harim-prototype"}, …].';
COMMENT ON COLUMN mountains.latitude IS 'Summit latitude (WGS 84).';
COMMENT ON COLUMN mountains.longitude IS 'Summit longitude (WGS 84).';
COMMENT ON COLUMN mountains.peak_type IS 'Landform type; NULL when unknown.';
COMMENT ON COLUMN mountains.volcanic_status IS 'Volcanic status where a source states it; NULL otherwise.';
COMMENT ON COLUMN mountains.prominence_m IS 'Topographic prominence in metres; NULL when no source gives it.';
COMMENT ON COLUMN mountains.isolation_km IS 'Topographic isolation in kilometres; NULL when no source gives it.';
COMMENT ON COLUMN mountains.summit_kind IS 'standalone, massif, or a summit of a massif (see the counting rule).';
COMMENT ON COLUMN mountains.parent_id IS 'For a summit, its massif.';
COMMENT ON COLUMN mountains.local_names IS 'Names in local languages: [{"name": "Kĩrĩnyaga", "language": "Kikuyu", "source": "…"}].';
COMMENT ON COLUMN mountains.name_origin IS 'What the name means or where it comes from, from a cited source.';
COMMENT ON COLUMN mountains.name_origin_source_id IS 'Source of the name origin.';
COMMENT ON COLUMN mountains.notes IS 'Short notes, e.g. how the record was reconciled.';
COMMENT ON COLUMN mountains.wikidata_qid IS 'Wikidata item, e.g. Q7296.';
COMMENT ON COLUMN mountains.geonames_id IS 'GeoNames feature id.';
COMMENT ON COLUMN mountains.territory_name IS 'For peaks outside the 54 countries (e.g. Réunion), the territory; such peaks have no country rows.';
COMMENT ON COLUMN mountains.needs_review IS 'True when sources disagree or a fact is unsourced (listed in data/mountains_review_report.md).';
COMMENT ON COLUMN mountains.review_notes IS 'Why the mountain needs review.';
COMMENT ON COLUMN mountains.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN mountains.updated_at IS 'When the row last changed.';

-- A summit's parent must be a massif; a massif keeps its kind while it has summits.
CREATE FUNCTION mountains_check_hierarchy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM mountains WHERE id = NEW.parent_id AND summit_kind = 'massif'
  ) THEN
    RAISE EXCEPTION 'Summit % must have a massif as its parent', NEW.slug;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.summit_kind = 'massif' AND NEW.summit_kind <> 'massif'
     AND EXISTS (SELECT 1 FROM mountains WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Mountain % still has summits, so it must stay a massif', NEW.slug;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION mountains_check_hierarchy() IS 'Enforces the two-level massif → summit hierarchy.';
CREATE TRIGGER mountains_hierarchy BEFORE INSERT OR UPDATE OF parent_id, summit_kind ON mountains
  FOR EACH ROW EXECUTE FUNCTION mountains_check_hierarchy();

-- At commit: every massif has at least one summit and stands exactly as high as its highest.
CREATE FUNCTION mountains_check_massif(massif integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  own     integer;
  kind    summit_kind;
  highest integer;
  massif_slug text;
BEGIN
  SELECT elevation_m, summit_kind, slug INTO own, kind, massif_slug FROM mountains WHERE id = massif;
  IF NOT FOUND OR kind <> 'massif' THEN
    RETURN;
  END IF;
  SELECT max(elevation_m) INTO highest FROM mountains WHERE parent_id = massif;
  IF highest IS NULL THEN
    RAISE EXCEPTION 'Massif % has no summits', massif_slug;
  END IF;
  IF highest <> own THEN
    RAISE EXCEPTION 'Massif % is % m but its highest summit is % m', massif_slug, own, highest;
  END IF;
END;
$$;
COMMENT ON FUNCTION mountains_check_massif(integer) IS
  'Raises unless the massif has summits and its elevation equals its highest summit''s.';

CREATE FUNCTION mountains_massif_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM mountains_check_massif(NEW.id);
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM mountains_check_massif(NEW.parent_id);
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.parent_id IS NOT NULL THEN
    PERFORM mountains_check_massif(OLD.parent_id);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION mountains_massif_consistency() IS 'Deferred check of massif elevations (see mountains_check_massif).';
CREATE CONSTRAINT TRIGGER mountains_massif_elevation
  AFTER INSERT OR UPDATE OR DELETE ON mountains
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION mountains_massif_consistency();

-- ── mountain_countries ───────────────────────────────────────────────────────

CREATE TABLE mountain_countries (
  mountain_id           integer NOT NULL REFERENCES mountains (id) ON DELETE CASCADE,
  country_id            smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  is_country_high_point boolean NOT NULL DEFAULT false,
  is_shared             boolean NOT NULL DEFAULT false,
  PRIMARY KEY (mountain_id, country_id)
);
-- At most one high point per country (the pipeline also checks every country has one).
CREATE UNIQUE INDEX mountain_countries_one_high_point ON mountain_countries (country_id)
  WHERE is_country_high_point;
CREATE INDEX mountain_countries_country_id_idx ON mountain_countries (country_id);

COMMENT ON TABLE mountain_countries IS
  'The countries a mountain lies in; a border peak has a row per country (is_shared) and still counts once.';
COMMENT ON COLUMN mountain_countries.mountain_id IS 'The mountain.';
COMMENT ON COLUMN mountain_countries.country_id IS 'A country the mountain lies in.';
COMMENT ON COLUMN mountain_countries.is_country_high_point IS 'True for the country''s highest point (exactly one per country; never a summit row).';
COMMENT ON COLUMN mountain_countries.is_shared IS 'True when the mountain lies on a border and appears under several countries.';

CREATE FUNCTION mountain_countries_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kind      summit_kind;
  territory text;
BEGIN
  SELECT summit_kind, territory_name INTO kind, territory FROM mountains WHERE id = NEW.mountain_id;
  IF territory IS NOT NULL THEN
    RAISE EXCEPTION 'Territory peaks are not in any of the 54 countries';
  END IF;
  IF NEW.is_country_high_point AND kind = 'summit' THEN
    RAISE EXCEPTION 'A country''s high point is a mountain (massif or standalone), not one of its summits';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION mountain_countries_check() IS
  'Keeps territory peaks out of countries and high points on counted mountains.';
CREATE TRIGGER mountain_countries_rules BEFORE INSERT OR UPDATE ON mountain_countries
  FOR EACH ROW EXECUTE FUNCTION mountain_countries_check();

-- ── mountain_sources ─────────────────────────────────────────────────────────

CREATE TABLE mountain_sources (
  mountain_id integer NOT NULL REFERENCES mountains (id) ON DELETE CASCADE,
  source_id   integer NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  field       mountain_field NOT NULL,
  PRIMARY KEY (mountain_id, source_id, field)
);
CREATE INDEX mountain_sources_source_id_idx ON mountain_sources (source_id);

COMMENT ON TABLE mountain_sources IS 'Which sources support which facts about which mountain.';
COMMENT ON COLUMN mountain_sources.mountain_id IS 'The mountain.';
COMMENT ON COLUMN mountain_sources.source_id IS 'The source.';
COMMENT ON COLUMN mountain_sources.field IS 'The fact the source supports.';

-- ── country_low_points ───────────────────────────────────────────────────────

CREATE TABLE country_low_points (
  country_id    smallint PRIMARY KEY REFERENCES countries (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (btrim(name) <> ''),
  elevation_m   integer NOT NULL CHECK (elevation_m BETWEEN -500 AND 6000),
  latitude      double precision CHECK (latitude BETWEEN -47 AND 38),
  longitude     double precision CHECK (longitude BETWEEN -26 AND 64),
  feature_type  low_point_feature NOT NULL,
  source_id     integer NOT NULL REFERENCES sources (id),
  wikidata_qid  text CHECK (wikidata_qid ~ '^Q[0-9]+$'),
  needs_review  boolean NOT NULL DEFAULT false,
  review_notes  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  -- Sea level on the coast is exactly 0 m.
  CHECK (feature_type <> 'coast' OR elevation_m = 0)
);
CREATE TRIGGER country_low_points_set_updated_at BEFORE UPDATE ON country_low_points
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE country_low_points IS
  'Each country''s lowest point (one row per country). Elevations can be negative: below sea level.';
COMMENT ON COLUMN country_low_points.country_id IS 'The country.';
COMMENT ON COLUMN country_low_points.name IS 'The feature, e.g. "Lake Assal" or "Atlantic Ocean (sea level)".';
COMMENT ON COLUMN country_low_points.elevation_m IS 'Elevation in metres; negative values are below sea level.';
COMMENT ON COLUMN country_low_points.latitude IS 'Latitude where a single point is meaningful; NULL for a coastline.';
COMMENT ON COLUMN country_low_points.longitude IS 'Longitude where a single point is meaningful; NULL for a coastline.';
COMMENT ON COLUMN country_low_points.feature_type IS 'depression, lake, river, salt flat, coast (sea level) or other.';
COMMENT ON COLUMN country_low_points.source_id IS 'Source of the low point.';
COMMENT ON COLUMN country_low_points.wikidata_qid IS 'Wikidata item of the feature.';
COMMENT ON COLUMN country_low_points.needs_review IS 'True when the value is uncertain or sources disagree.';
COMMENT ON COLUMN country_low_points.review_notes IS 'Why the low point needs review.';
COMMENT ON COLUMN country_low_points.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN country_low_points.updated_at IS 'When the row last changed.';
