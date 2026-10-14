-- 0001_core.sql
-- Core reference schema: regions, countries and their symbology profiles, cited sources,
-- dataset coverage and pipeline run logs.
--
-- Roles (see db/roles.sql, run once by the database owner): the Netlify Functions connect as a
-- read-only role (bla_reader); only the pipelines connect as the write role (bla_writer), which
-- also applies these migrations.
--
-- Extension path (not built in v1): time-series indicators will add
--   indicators   (id, key, name, unit, source_id, description)
--   observations (country_id, indicator_id, date, value, PRIMARY KEY (country_id, indicator_id, date))
-- registered in `datasets` like every other dataset.

-- ── Enumerations (closed value sets) ─────────────────────────────────────────

CREATE TYPE reliability_tier AS ENUM ('primary', 'reference', 'secondary', 'low');
COMMENT ON TYPE reliability_tier IS
  'How far a source can be trusted: primary (official), reference (encyclopedias), secondary (journalism, books), low (forums, social media, fan wikis, aggregators).';

CREATE TYPE etymology_category AS ENUM (
  'geographic_feature', 'ethnic_group', 'kingdom_or_ruler', 'colonial_or_translation'
);
COMMENT ON TYPE etymology_category IS
  'The four categories of country-name origin defined in the research document''s introduction.';

CREATE TYPE animal_status AS ENUM ('official', 'de_facto', 'inferred', 'sports_nickname', 'contested');
COMMENT ON TYPE animal_status IS
  'The basis on which an animal is presented as a country''s national animal (rules in data/review_report.md).';

CREATE TYPE profile_field AS ENUM ('etymology', 'flag_design', 'national_symbol', 'national_animal');
COMMENT ON TYPE profile_field IS 'A field of a country profile that a source can support.';

CREATE TYPE ingestion_status AS ENUM ('running', 'succeeded', 'failed');
COMMENT ON TYPE ingestion_status IS 'Outcome of a pipeline run.';

CREATE TYPE refresh_cadence AS ENUM ('static', 'manual', 'weekly', 'monthly', 'quarterly', 'annual', 'on_release');
COMMENT ON TYPE refresh_cadence IS 'How often a dataset is expected to be refreshed.';

-- ── updated_at maintenance ───────────────────────────────────────────────────

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION set_updated_at() IS 'Trigger function keeping updated_at current on UPDATE.';

-- ── regions ──────────────────────────────────────────────────────────────────

CREATE TABLE regions (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]*$'),
  name        text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  description text,
  color_hex   text CHECK (color_hex ~ '^#[0-9a-f]{6}$'),
  sort_order  smallint NOT NULL UNIQUE CHECK (sort_order > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER regions_set_updated_at BEFORE UPDATE ON regions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE regions IS
  'The five regions of the research document''s grouping (North, West, Central, East, Southern). Data, so it can change.';
COMMENT ON COLUMN regions.id IS 'Surrogate key.';
COMMENT ON COLUMN regions.slug IS 'Stable URL key, e.g. "west" (used in ?region= filters and CSS variables).';
COMMENT ON COLUMN regions.name IS 'Display name, e.g. "West Africa".';
COMMENT ON COLUMN regions.description IS 'Regional introduction from the research document (citations removed).';
COMMENT ON COLUMN regions.color_hex IS
  'Region identity colour: the mode colour across the region''s flags (computed by the flags pipeline; lowercase #rrggbb). NULL until computed.';
COMMENT ON COLUMN regions.sort_order IS 'Display order (document order).';
COMMENT ON COLUMN regions.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN regions.updated_at IS 'When the row last changed.';

-- ── countries ────────────────────────────────────────────────────────────────

CREATE TABLE countries (
  id                   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  iso2                 char(2) NOT NULL UNIQUE CHECK (iso2 ~ '^[A-Z]{2}$'),
  iso3                 char(3) NOT NULL UNIQUE CHECK (iso3 ~ '^[A-Z]{3}$'),
  iso_numeric          smallint NOT NULL UNIQUE CHECK (iso_numeric BETWEEN 1 AND 999),
  name                 text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  official_name        text,
  region_id            smallint NOT NULL REFERENCES regions (id),
  flag_url_template    text NOT NULL CHECK (flag_url_template LIKE 'https://%{width}%'),
  centroid_lon         double precision CHECK (centroid_lon BETWEEN -180 AND 180),
  centroid_lat         double precision CHECK (centroid_lat BETWEEN -90 AND 90),
  is_microstate_marker boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((centroid_lon IS NULL) = (centroid_lat IS NULL))
);
CREATE INDEX countries_region_id_idx ON countries (region_id);
CREATE TRIGGER countries_set_updated_at BEFORE UPDATE ON countries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE countries IS 'The 54 sovereign African states covered by the research document.';
COMMENT ON COLUMN countries.id IS 'Surrogate key.';
COMMENT ON COLUMN countries.iso2 IS 'ISO 3166-1 alpha-2 code (also the Flagpedia flag code, lowercased).';
COMMENT ON COLUMN countries.iso3 IS 'ISO 3166-1 alpha-3 code; the public identifier in URLs and the API.';
COMMENT ON COLUMN countries.iso_numeric IS 'ISO 3166-1 numeric code (joins to Natural Earth boundaries).';
COMMENT ON COLUMN countries.name IS 'Common English name with proper diacritics, e.g. "Côte d''Ivoire".';
COMMENT ON COLUMN countries.official_name IS 'Formal state name, e.g. "Republic of Kenya".';
COMMENT ON COLUMN countries.region_id IS 'Region per the research document''s grouping.';
COMMENT ON COLUMN countries.flag_url_template IS
  'Flagpedia (flagcdn.com) PNG URL with a {width} placeholder, e.g. https://flagcdn.com/w{width}/ke.png.';
COMMENT ON COLUMN countries.centroid_lon IS 'Label/marker longitude (WGS84), set by the boundaries pipeline.';
COMMENT ON COLUMN countries.centroid_lat IS 'Label/marker latitude (WGS84), set by the boundaries pipeline.';
COMMENT ON COLUMN countries.is_microstate_marker IS
  'True when the country is too small to click on the map and gets a circle marker (island and micro-states).';
COMMENT ON COLUMN countries.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN countries.updated_at IS 'When the row last changed.';

-- ── country_profiles ─────────────────────────────────────────────────────────

CREATE TABLE country_profiles (
  country_id                 smallint PRIMARY KEY REFERENCES countries (id) ON DELETE CASCADE,
  etymology_summary          text NOT NULL CHECK (btrim(etymology_summary) <> ''),
  etymology_detail           text,
  etymology_category         etymology_category,
  flag_design_summary        text NOT NULL CHECK (btrim(flag_design_summary) <> ''),
  flag_design_detail         text,
  national_symbol_summary    text NOT NULL CHECK (btrim(national_symbol_summary) <> ''),
  national_symbol_detail     text,
  national_animal_name       text NOT NULL CHECK (btrim(national_animal_name) <> ''),
  national_animal_scientific text,
  national_animal_detail     text,
  animal_status              animal_status NOT NULL,
  needs_review               boolean NOT NULL DEFAULT false,
  review_notes               text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX country_profiles_needs_review_idx ON country_profiles (country_id) WHERE needs_review;
CREATE TRIGGER country_profiles_set_updated_at BEFORE UPDATE ON country_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE country_profiles IS
  'Symbology profile per country (1:1): short summaries from the document''s tables for table cells and tooltips, long prose for detail views.';
COMMENT ON COLUMN country_profiles.country_id IS 'The country this profile describes.';
COMMENT ON COLUMN country_profiles.etymology_summary IS 'Short meaning of the name (document table), e.g. "Spotted Mountain".';
COMMENT ON COLUMN country_profiles.etymology_detail IS 'Prose explanation of the name''s origin (document text, citations removed).';
COMMENT ON COLUMN country_profiles.etymology_category IS
  'Which of the four origin categories applies. NULL until assigned by a reviewer (proposals are in the review report).';
COMMENT ON COLUMN country_profiles.flag_design_summary IS 'Short flag description from the document table (used in tooltips).';
COMMENT ON COLUMN country_profiles.flag_design_detail IS 'Prose description of the flag and its symbolism.';
COMMENT ON COLUMN country_profiles.national_symbol_summary IS 'Short national symbol/emblem description from the document table.';
COMMENT ON COLUMN country_profiles.national_symbol_detail IS 'Prose about the national symbol, emblem or coat of arms. NULL when the document has none.';
COMMENT ON COLUMN country_profiles.national_animal_name IS 'National animal(s) as named in the document table, without status qualifiers.';
COMMENT ON COLUMN country_profiles.national_animal_scientific IS
  'Scientific name when the document gives one; prefixed with the common name when several animals are listed.';
COMMENT ON COLUMN country_profiles.national_animal_detail IS 'Prose about the national animal(s).';
COMMENT ON COLUMN country_profiles.animal_status IS 'Basis for presenting the animal as national (official, de facto, inferred, sports nickname, contested).';
COMMENT ON COLUMN country_profiles.needs_review IS
  'True while the record relies mainly on low-reliability sources or has a known inconsistency; shown in the UI as "needs verification". Cleared by a reviewer in the seed.';
COMMENT ON COLUMN country_profiles.review_notes IS 'Why the record needs review (one reason per line).';
COMMENT ON COLUMN country_profiles.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN country_profiles.updated_at IS 'When the row last changed.';

-- ── flag_palette ─────────────────────────────────────────────────────────────

CREATE TABLE flag_palette (
  country_id smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  hex        text NOT NULL CHECK (hex ~ '^#[0-9a-f]{6}$'),
  area_share numeric(6, 5) NOT NULL CHECK (area_share > 0 AND area_share <= 1),
  PRIMARY KEY (country_id, hex)
);

COMMENT ON TABLE flag_palette IS
  'Colours found in each flag and the share of the flag''s area they cover; makes the region-colour computation reproducible and auditable.';
COMMENT ON COLUMN flag_palette.country_id IS 'The flag''s country.';
COMMENT ON COLUMN flag_palette.hex IS 'Cluster colour (lowercase #rrggbb).';
COMMENT ON COLUMN flag_palette.area_share IS 'Fraction of the rasterised flag area in this colour cluster (0-1).';

-- ── sources ──────────────────────────────────────────────────────────────────

CREATE TABLE sources (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_key       text NOT NULL UNIQUE CHECK (source_key ~ '^[a-z0-9][a-z0-9-]*$'),
  ref_no           smallint UNIQUE CHECK (ref_no > 0),
  title            text NOT NULL CHECK (btrim(title) <> ''),
  url              text NOT NULL CHECK (url ~ '^https?://'),
  source_type      text NOT NULL,
  reliability_tier reliability_tier NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER sources_set_updated_at BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sources IS 'Every cited source (the research document''s works cited, and later datasets'' references).';
COMMENT ON COLUMN sources.id IS 'Surrogate key.';
COMMENT ON COLUMN sources.source_key IS 'Natural key used for idempotent upserts, e.g. "symbology-ref-18".';
COMMENT ON COLUMN sources.ref_no IS 'The numbered citation in the research PDF''s works cited; NULL for other sources.';
COMMENT ON COLUMN sources.title IS 'Title as cited.';
COMMENT ON COLUMN sources.url IS 'Link to the source.';
COMMENT ON COLUMN sources.source_type IS 'Kind of source, e.g. encyclopedia, news, aggregator, forum, social_media, fan_wiki.';
COMMENT ON COLUMN sources.reliability_tier IS 'Reliability tier (rules in pipelines/africa_pipelines/reference/source_tiers.json).';
COMMENT ON COLUMN sources.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN sources.updated_at IS 'When the row last changed.';

-- ── country_sources ──────────────────────────────────────────────────────────

CREATE TABLE country_sources (
  country_id smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  source_id  integer NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  field      profile_field NOT NULL,
  PRIMARY KEY (country_id, source_id, field)
);
CREATE INDEX country_sources_source_id_idx ON country_sources (source_id);

COMMENT ON TABLE country_sources IS 'Which sources support which field of which country profile.';
COMMENT ON COLUMN country_sources.country_id IS 'The country whose profile cites the source.';
COMMENT ON COLUMN country_sources.source_id IS 'The cited source.';
COMMENT ON COLUMN country_sources.field IS 'The profile field the citation supports.';

-- ── datasets ─────────────────────────────────────────────────────────────────

CREATE TABLE datasets (
  id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key               text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9-]*$'),
  name              text NOT NULL,
  provider          text NOT NULL,
  license           text NOT NULL,
  attribution       text NOT NULL,
  coverage_start    date,
  coverage_end      date,
  as_of             date NOT NULL,
  last_refreshed_at timestamptz,
  refresh_cadence   refresh_cadence NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_start IS NULL OR coverage_end IS NULL OR coverage_start <= coverage_end)
);
CREATE TRIGGER datasets_set_updated_at BEFORE UPDATE ON datasets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE datasets IS
  'Each external or curated dataset behind the app, with licence, attribution and coverage; drives the data ribbon.';
COMMENT ON COLUMN datasets.id IS 'Surrogate key.';
COMMENT ON COLUMN datasets.key IS 'Stable key referenced by routes and the API, e.g. "symbology-pdf".';
COMMENT ON COLUMN datasets.name IS 'Display name.';
COMMENT ON COLUMN datasets.provider IS 'Who publishes the data.';
COMMENT ON COLUMN datasets.license IS 'Licence or terms of use.';
COMMENT ON COLUMN datasets.attribution IS 'Required attribution wording, shown in the footer and exports.';
COMMENT ON COLUMN datasets.coverage_start IS 'First date covered (time-series datasets); NULL for reference data.';
COMMENT ON COLUMN datasets.coverage_end IS 'Last date covered (time-series datasets); NULL for reference data.';
COMMENT ON COLUMN datasets.as_of IS 'Date the data describes or was published.';
COMMENT ON COLUMN datasets.last_refreshed_at IS 'When a pipeline last loaded this dataset successfully.';
COMMENT ON COLUMN datasets.refresh_cadence IS 'Expected refresh frequency.';
COMMENT ON COLUMN datasets.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN datasets.updated_at IS 'When the row last changed.';

-- ── ingestion_runs ───────────────────────────────────────────────────────────

CREATE TABLE ingestion_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id    smallint NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        ingestion_status NOT NULL DEFAULT 'running',
  rows_upserted integer CHECK (rows_upserted >= 0),
  log           text,
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK ((status = 'running') = (finished_at IS NULL))
);
CREATE INDEX ingestion_runs_dataset_started_idx ON ingestion_runs (dataset_id, started_at DESC);

COMMENT ON TABLE ingestion_runs IS 'One row per pipeline run, for auditing and the `status` command.';
COMMENT ON COLUMN ingestion_runs.id IS 'Surrogate key.';
COMMENT ON COLUMN ingestion_runs.dataset_id IS 'The dataset the run loaded.';
COMMENT ON COLUMN ingestion_runs.started_at IS 'When the run started.';
COMMENT ON COLUMN ingestion_runs.finished_at IS 'When the run ended; NULL while running.';
COMMENT ON COLUMN ingestion_runs.status IS 'running, succeeded or failed.';
COMMENT ON COLUMN ingestion_runs.rows_upserted IS 'Rows inserted or updated by the run.';
COMMENT ON COLUMN ingestion_runs.log IS 'Summary log or error message.';
