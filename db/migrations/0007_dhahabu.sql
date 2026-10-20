-- 0007_dhahabu.sql
-- Dhahabu (gold): the monthly gold price, mine production, central bank holdings, in-ground
-- reserves, trade (as reported and as mirrored by partners), each country's presence tier and
-- profile notes, and an optional mines layer. Sources and licences: docs/dhahabu-sources.md.
--
-- Conventions (enforced here and in the pipelines' validation):
--   * tonnes are metric tonnes of fine gold; troy_oz_per_tonne() is the one SQL copy of the
--     constant in config/constants.json (a test checks they agree);
--   * money is nominal US dollars;
--   * NULL means no data, 0 a reported zero, and a country inside a source's "other countries"
--     row is basis 'included_in_other' with NULL tonnes. One is never coerced into another;
--   * every row carries its own year or date, so the API can serve ranges.

-- ── The tonne / troy ounce constant ──────────────────────────────────────────

CREATE FUNCTION troy_oz_per_tonne() RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 32150.7466::numeric $$;
COMMENT ON FUNCTION troy_oz_per_tonne() IS
  'Troy ounces in one metric tonne (32,150.7466). Must equal TROY_OZ_PER_TONNE in config/constants.json.';

-- ── Enumerations ─────────────────────────────────────────────────────────────

CREATE TYPE gold_presence_tier AS ENUM (
  'major_producer', 'producer', 'occurrences_known', 'none_identified', 'unknown'
);
COMMENT ON TYPE gold_presence_tier IS
  'Whether gold is known in a country (rules in pipelines/africa_pipelines/reference/gold_config.json). none_identified means none found in the sources consulted, never "no gold".';

CREATE TYPE gold_production_basis AS ENUM ('reported', 'estimate', 'included_in_other');
COMMENT ON TYPE gold_production_basis IS
  'reported: a figure the source reports; estimate: the source''s estimate; included_in_other: the source lumps the country into "other countries" (tonnes NULL).';

CREATE TYPE gold_trade_flow AS ENUM ('export', 'import');
COMMENT ON TYPE gold_trade_flow IS 'Direction of a trade flow, from the African country''s side.';

CREATE TYPE gold_trade_basis AS ENUM ('reported', 'mirror');
COMMENT ON TYPE gold_trade_basis IS
  'reported: as the country reports it; mirror: as its trading partners report the same flow (their imports from it, or exports to it).';

CREATE TYPE gold_valuation AS ENUM ('market', 'national', 'computed');
COMMENT ON TYPE gold_valuation IS
  'How a central bank holding''s US dollar value was obtained: market (the source''s market value), national (the reporter''s own valuation) or computed (tonnes × the month''s average price).';

-- ── gold_price_monthly ───────────────────────────────────────────────────────

CREATE TABLE gold_price_monthly (
  month           date PRIMARY KEY CHECK (month = date_trunc('month', month)::date),
  usd_per_troy_oz numeric(12, 4) NOT NULL CHECK (usd_per_troy_oz > 0),
  source_id       integer NOT NULL REFERENCES sources (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER gold_price_monthly_set_updated_at BEFORE UPDATE ON gold_price_monthly
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE gold_price_monthly IS
  'The gold price as a monthly average (not a live spot price), nominal US dollars per troy ounce.';
COMMENT ON COLUMN gold_price_monthly.month IS 'First day of the month the average covers.';
COMMENT ON COLUMN gold_price_monthly.usd_per_troy_oz IS 'Monthly average price, nominal US dollars per troy ounce.';
COMMENT ON COLUMN gold_price_monthly.source_id IS 'Where the price comes from (the World Bank Pink Sheet, or the IMF fallback).';
COMMENT ON COLUMN gold_price_monthly.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN gold_price_monthly.updated_at IS 'When the row last changed.';

CREATE VIEW v_gold_price_annual AS
SELECT
  extract(year FROM month)::int AS year,
  count(*)::int AS months,
  count(*) = 12 AS is_complete,
  avg(usd_per_troy_oz) AS mean_usd_per_troy_oz,
  (array_agg(usd_per_troy_oz ORDER BY month DESC))[1] AS last_usd_per_troy_oz,
  max(usd_per_troy_oz) FILTER (WHERE extract(month FROM month) = 12) AS year_end_usd_per_troy_oz
FROM gold_price_monthly
GROUP BY 1;

COMMENT ON VIEW v_gold_price_annual IS
  'Annual gold price from the monthly averages. Only complete years (12 months) value production.';
COMMENT ON COLUMN v_gold_price_annual.year IS 'Calendar year.';
COMMENT ON COLUMN v_gold_price_annual.months IS 'How many monthly prices the year has.';
COMMENT ON COLUMN v_gold_price_annual.is_complete IS 'True when all 12 months are present.';
COMMENT ON COLUMN v_gold_price_annual.mean_usd_per_troy_oz IS 'Mean of the monthly averages, US dollars per troy ounce.';
COMMENT ON COLUMN v_gold_price_annual.last_usd_per_troy_oz IS 'The latest monthly average in the year (the year to date for an incomplete year).';
COMMENT ON COLUMN v_gold_price_annual.year_end_usd_per_troy_oz IS 'December''s monthly average; NULL until December is published.';

-- ── country_gold_profiles ────────────────────────────────────────────────────

CREATE TABLE country_gold_profiles (
  country_id             smallint PRIMARY KEY REFERENCES countries (id) ON DELETE CASCADE,
  presence_tier          gold_presence_tier NOT NULL,
  presence_basis         text NOT NULL CHECK (btrim(presence_basis) <> ''),
  presence_confidence    confidence_level NOT NULL,
  presence_as_of_year    smallint CHECK (presence_as_of_year BETWEEN 1900 AND 2100),
  presence_source_id     integer REFERENCES sources (id),
  commercial_mining      boolean,
  asm_present            boolean,
  asm_share_pct_estimate numeric(5, 1) CHECK (asm_share_pct_estimate BETWEEN 0 AND 100),
  asm_source_id          integer REFERENCES sources (id),
  summary                text NOT NULL CHECK (btrim(summary) <> ''),
  needs_review           boolean NOT NULL DEFAULT false,
  review_notes           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- A tier other than "unknown" rests on a cited source, or is flagged for review.
  CHECK (presence_tier = 'unknown' OR presence_source_id IS NOT NULL OR needs_review),
  CHECK (asm_share_pct_estimate IS NULL OR asm_source_id IS NOT NULL)
);
CREATE TRIGGER country_gold_profiles_set_updated_at BEFORE UPDATE ON country_gold_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE country_gold_profiles IS
  'One row per country: whether gold is known there (with the evidence and confidence), mining context and a factual summary.';
COMMENT ON COLUMN country_gold_profiles.country_id IS 'The country described.';
COMMENT ON COLUMN country_gold_profiles.presence_tier IS 'Presence tier (major producer, producer, occurrences known, none identified in the sources consulted, unknown).';
COMMENT ON COLUMN country_gold_profiles.presence_basis IS 'The evidence for the tier, in words (figures with their year and source).';
COMMENT ON COLUMN country_gold_profiles.presence_confidence IS 'How far the tier can be trusted (high, medium, low).';
COMMENT ON COLUMN country_gold_profiles.presence_as_of_year IS 'The year the evidence describes.';
COMMENT ON COLUMN country_gold_profiles.presence_source_id IS 'The main source of the evidence.';
COMMENT ON COLUMN country_gold_profiles.commercial_mining IS 'True when a source reports industrial (large-scale) gold mine output; NULL when unknown.';
COMMENT ON COLUMN country_gold_profiles.asm_present IS 'True when a source reports artisanal and small-scale gold mining; NULL when unknown.';
COMMENT ON COLUMN country_gold_profiles.asm_share_pct_estimate IS 'Artisanal and small-scale share of gold output, per cent, where a source gives the split.';
COMMENT ON COLUMN country_gold_profiles.asm_source_id IS 'The source of the artisanal share.';
COMMENT ON COLUMN country_gold_profiles.summary IS 'A short factual summary built from the sourced figures.';
COMMENT ON COLUMN country_gold_profiles.needs_review IS 'True while the profile rests on weak or conflicting evidence; shown in the UI.';
COMMENT ON COLUMN country_gold_profiles.review_notes IS 'Why the profile needs review (one reason per line).';
COMMENT ON COLUMN country_gold_profiles.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN country_gold_profiles.updated_at IS 'When the row last changed.';

-- ── gold_profile_notes ───────────────────────────────────────────────────────

CREATE TABLE gold_profile_notes (
  country_id   smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  sort_order   smallint NOT NULL CHECK (sort_order > 0),
  note         text NOT NULL CHECK (btrim(note) <> ''),
  source_id    integer NOT NULL REFERENCES sources (id),
  as_of        date NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  review_notes text,
  PRIMARY KEY (country_id, sort_order)
);
CREATE INDEX gold_profile_notes_source_id_idx ON gold_profile_notes (source_id);

COMMENT ON TABLE gold_profile_notes IS
  'Short factual notes about gold in a country (artisanal mining, policies, discoveries), each attributed to a cited source and dated. No unsourced claims.';
COMMENT ON COLUMN gold_profile_notes.country_id IS 'The country the note is about.';
COMMENT ON COLUMN gold_profile_notes.sort_order IS 'Display order within the country.';
COMMENT ON COLUMN gold_profile_notes.note IS 'The note, worded as the source states it.';
COMMENT ON COLUMN gold_profile_notes.source_id IS 'The source the note is attributed to.';
COMMENT ON COLUMN gold_profile_notes.as_of IS 'The date of the source (or the period it describes).';
COMMENT ON COLUMN gold_profile_notes.needs_review IS 'True until a reviewer has checked the note.';
COMMENT ON COLUMN gold_profile_notes.review_notes IS 'Why the note needs review.';

-- ── gold_production_annual ───────────────────────────────────────────────────

CREATE TABLE gold_production_annual (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  year       smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  tonnes     numeric(12, 3) CHECK (tonnes >= 0),
  basis      gold_production_basis NOT NULL,
  source_id  integer NOT NULL REFERENCES sources (id),
  notes      text,
  UNIQUE (country_id, year, source_id),
  CHECK ((basis = 'included_in_other') = (tonnes IS NULL))
);
CREATE INDEX gold_production_annual_year_idx ON gold_production_annual (year);

COMMENT ON TABLE gold_production_annual IS
  'Gold mine production by country and year, one row per source (editions disagree and revise each other). v_gold_production picks one per country-year.';
COMMENT ON COLUMN gold_production_annual.id IS 'Surrogate key.';
COMMENT ON COLUMN gold_production_annual.country_id IS 'The producing country.';
COMMENT ON COLUMN gold_production_annual.year IS 'Calendar year of production.';
COMMENT ON COLUMN gold_production_annual.tonnes IS 'Metric tonnes of fine gold; NULL only for included_in_other (no data is no row).';
COMMENT ON COLUMN gold_production_annual.basis IS 'reported, estimate, or included_in_other (the source''s "other countries" row).';
COMMENT ON COLUMN gold_production_annual.source_id IS 'The source (one row per publication edition).';
COMMENT ON COLUMN gold_production_annual.notes IS 'The source''s own notes on the figure, e.g. what it excludes.';

CREATE TABLE gold_production_source_priority (
  source_id integer PRIMARY KEY REFERENCES sources (id) ON DELETE CASCADE,
  priority  smallint NOT NULL UNIQUE CHECK (priority > 0)
);

COMMENT ON TABLE gold_production_source_priority IS
  'Which production source wins when several give the same kind of figure for a country-year (lowest number first). Generated from gold_config.json: newer editions before older ones.';
COMMENT ON COLUMN gold_production_source_priority.source_id IS 'A production source.';
COMMENT ON COLUMN gold_production_source_priority.priority IS 'Rank; 1 is preferred.';

CREATE VIEW v_gold_production AS
SELECT DISTINCT ON (p.country_id, p.year)
  p.country_id,
  p.year,
  p.tonnes,
  p.basis,
  p.source_id,
  p.notes,
  a.mean_usd_per_troy_oz AS price_usd_per_troy_oz,
  p.tonnes * troy_oz_per_tonne() * a.mean_usd_per_troy_oz AS value_usd,
  true AS value_is_computed
FROM gold_production_annual p
LEFT JOIN gold_production_source_priority sp ON sp.source_id = p.source_id
LEFT JOIN v_gold_price_annual a ON a.year = p.year AND a.is_complete
-- A figure beats "included in other", a reported figure beats an estimate, then the preferred
-- source (newer editions first).
ORDER BY p.country_id, p.year, p.tonnes IS NULL, p.basis <> 'reported', sp.priority NULLS LAST,
  p.source_id;

COMMENT ON VIEW v_gold_production IS
  'One production figure per country-year (a figure over "included in other", reported over estimated, then the source priority), valued at that year''s mean monthly price: value_usd = tonnes × troy_oz_per_tonne() × the annual mean price. The value is NULL until the year''s 12 monthly prices exist (never filled).';
COMMENT ON COLUMN v_gold_production.country_id IS 'The producing country.';
COMMENT ON COLUMN v_gold_production.year IS 'Calendar year of production.';
COMMENT ON COLUMN v_gold_production.tonnes IS 'Metric tonnes of fine gold; NULL when included in other countries.';
COMMENT ON COLUMN v_gold_production.basis IS 'reported, estimate or included_in_other.';
COMMENT ON COLUMN v_gold_production.source_id IS 'The preferred source for this country-year.';
COMMENT ON COLUMN v_gold_production.notes IS 'The source''s notes on the figure.';
COMMENT ON COLUMN v_gold_production.price_usd_per_troy_oz IS 'The year''s mean monthly gold price used for the value.';
COMMENT ON COLUMN v_gold_production.value_usd IS 'Computed value in nominal US dollars (not a reported figure).';
COMMENT ON COLUMN v_gold_production.value_is_computed IS 'Always true: production values are computed, never reported.';

-- ── gold_trade_annual ────────────────────────────────────────────────────────

CREATE TABLE gold_trade_annual (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id    smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  year          smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  flow          gold_trade_flow NOT NULL,
  hs_code       text NOT NULL DEFAULT '7108' CHECK (hs_code IN ('7108', '7108.1')),
  net_weight_kg numeric(16, 3) CHECK (net_weight_kg >= 0),
  value_usd     numeric(18, 2) NOT NULL CHECK (value_usd >= 0),
  basis         gold_trade_basis NOT NULL,
  partner_count smallint CHECK (partner_count >= 0),
  source_id     integer NOT NULL REFERENCES sources (id),
  notes         text,
  UNIQUE (country_id, year, flow, hs_code, basis)
);
CREATE INDEX gold_trade_annual_year_idx ON gold_trade_annual (year);

COMMENT ON TABLE gold_trade_annual IS
  'Annual gold trade of each country: as the country reports it, and as its partners mirror it. Large gaps between the two are normal and informative.';
COMMENT ON COLUMN gold_trade_annual.id IS 'Surrogate key.';
COMMENT ON COLUMN gold_trade_annual.country_id IS 'The African country whose trade this is.';
COMMENT ON COLUMN gold_trade_annual.year IS 'Calendar year.';
COMMENT ON COLUMN gold_trade_annual.flow IS 'export or import, from the country''s side.';
COMMENT ON COLUMN gold_trade_annual.hs_code IS
  'Commodity code: 7108.1 = non-monetary gold (HS 7108.11–7108.13, i.e. heading 7108 without monetary gold 7108.20); 7108 = the whole heading.';
COMMENT ON COLUMN gold_trade_annual.net_weight_kg IS 'Net weight in kilograms; NULL when not reported.';
COMMENT ON COLUMN gold_trade_annual.value_usd IS 'Trade value in nominal US dollars (exports FOB, imports CIF, as each reporter records them).';
COMMENT ON COLUMN gold_trade_annual.basis IS 'reported (by the country) or mirror (summed from its partners'' reports).';
COMMENT ON COLUMN gold_trade_annual.partner_count IS 'How many partner reporters a mirror figure sums; NULL for reported rows.';
COMMENT ON COLUMN gold_trade_annual.source_id IS 'The source (UN Comtrade).';
COMMENT ON COLUMN gold_trade_annual.notes IS 'Notes on the figure, e.g. a missing net weight.';

-- ── gold_trade_partners ──────────────────────────────────────────────────────

CREATE TABLE gold_trade_partners (
  country_id    smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  year          smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  flow          gold_trade_flow NOT NULL,
  basis         gold_trade_basis NOT NULL,
  rank          smallint NOT NULL CHECK (rank BETWEEN 1 AND 10),
  partner_name  text NOT NULL CHECK (btrim(partner_name) <> ''),
  partner_iso3  char(3) CHECK (partner_iso3 ~ '^[A-Z]{3}$'),
  value_usd     numeric(18, 2) NOT NULL CHECK (value_usd >= 0),
  net_weight_kg numeric(16, 3) CHECK (net_weight_kg >= 0),
  source_id     integer NOT NULL REFERENCES sources (id),
  PRIMARY KEY (country_id, year, flow, basis, rank)
);

COMMENT ON TABLE gold_trade_partners IS
  'The top 10 partners of each country''s gold trade per year, flow and basis (non-monetary gold).';
COMMENT ON COLUMN gold_trade_partners.country_id IS 'The African country.';
COMMENT ON COLUMN gold_trade_partners.year IS 'Calendar year.';
COMMENT ON COLUMN gold_trade_partners.flow IS 'export or import, from the country''s side.';
COMMENT ON COLUMN gold_trade_partners.basis IS 'reported (the country''s partner breakdown) or mirror (each partner''s own report).';
COMMENT ON COLUMN gold_trade_partners.rank IS 'Rank by value, 1 = largest.';
COMMENT ON COLUMN gold_trade_partners.partner_name IS 'The partner as UN Comtrade names it.';
COMMENT ON COLUMN gold_trade_partners.partner_iso3 IS 'The partner''s ISO alpha-3 code; NULL for groupings such as "Areas, nes".';
COMMENT ON COLUMN gold_trade_partners.value_usd IS 'Trade value in nominal US dollars.';
COMMENT ON COLUMN gold_trade_partners.net_weight_kg IS 'Net weight in kilograms; NULL when not reported.';
COMMENT ON COLUMN gold_trade_partners.source_id IS 'The source (UN Comtrade).';

-- ── country_total_exports_annual ─────────────────────────────────────────────

CREATE TABLE country_total_exports_annual (
  country_id smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  year       smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  value_usd  numeric(18, 2) NOT NULL CHECK (value_usd >= 0),
  source_id  integer NOT NULL REFERENCES sources (id),
  PRIMARY KEY (country_id, year)
);

COMMENT ON TABLE country_total_exports_annual IS
  'Total merchandise exports as each country reports them, to compute gold''s share of exports (same year for both parts).';
COMMENT ON COLUMN country_total_exports_annual.country_id IS 'The exporting country.';
COMMENT ON COLUMN country_total_exports_annual.year IS 'Calendar year.';
COMMENT ON COLUMN country_total_exports_annual.value_usd IS 'Total merchandise exports, nominal US dollars.';
COMMENT ON COLUMN country_total_exports_annual.source_id IS 'The source (UN Comtrade).';

-- ── gold_official_reserves ───────────────────────────────────────────────────

CREATE TABLE gold_official_reserves (
  country_id            smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  as_of                 date NOT NULL
    CHECK (as_of = (date_trunc('month', as_of) + interval '1 month - 1 day')::date),
  tonnes                numeric(12, 3) NOT NULL CHECK (tonnes >= 0),
  value_usd             numeric(18, 2) NOT NULL CHECK (value_usd >= 0),
  pct_of_total_reserves numeric(6, 2) CHECK (pct_of_total_reserves BETWEEN 0 AND 100),
  valuation             gold_valuation NOT NULL,
  source_id             integer NOT NULL REFERENCES sources (id),
  PRIMARY KEY (country_id, as_of)
);
CREATE INDEX gold_official_reserves_as_of_idx ON gold_official_reserves (as_of);

COMMENT ON TABLE gold_official_reserves IS
  'Central bank (official) gold holdings at month end. A different concept from in-ground reserves; never mix the two.';
COMMENT ON COLUMN gold_official_reserves.country_id IS 'The country whose monetary authority holds the gold.';
COMMENT ON COLUMN gold_official_reserves.as_of IS 'Month end the holding refers to.';
COMMENT ON COLUMN gold_official_reserves.tonnes IS 'Metric tonnes of fine gold (converted from fine troy ounces).';
COMMENT ON COLUMN gold_official_reserves.value_usd IS 'Value in nominal US dollars; see valuation.';
COMMENT ON COLUMN gold_official_reserves.pct_of_total_reserves IS 'Gold''s share of total reserves at market value, per cent, from the source''s values in one currency.';
COMMENT ON COLUMN gold_official_reserves.valuation IS 'market, national or computed (tonnes × that month''s average price).';
COMMENT ON COLUMN gold_official_reserves.source_id IS 'The source (IMF International Liquidity).';

-- ── gold_inground_reserves ───────────────────────────────────────────────────

CREATE TABLE gold_inground_reserves (
  country_id       smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  year             smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  tonnes_contained numeric(12, 1) NOT NULL CHECK (tonnes_contained >= 0),
  definition       text NOT NULL CHECK (btrim(definition) <> ''),
  source_id        integer NOT NULL REFERENCES sources (id),
  PRIMARY KEY (country_id, year, source_id)
);

COMMENT ON TABLE gold_inground_reserves IS
  'Geological reserves: gold still in the ground that is economically extractable by the source''s definition. Not central bank holdings.';
COMMENT ON COLUMN gold_inground_reserves.country_id IS 'The country.';
COMMENT ON COLUMN gold_inground_reserves.year IS 'The year the estimate describes.';
COMMENT ON COLUMN gold_inground_reserves.tonnes_contained IS 'Metric tonnes of gold contained.';
COMMENT ON COLUMN gold_inground_reserves.definition IS 'The source''s definition of reserves.';
COMMENT ON COLUMN gold_inground_reserves.source_id IS 'The source edition.';

-- ── gold_mines (optional layer) ──────────────────────────────────────────────

CREATE TABLE gold_mines (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  country_id   smallint NOT NULL REFERENCES countries (id) ON DELETE CASCADE,
  latitude     double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  status       text,
  operator     text,
  wikidata_qid text UNIQUE CHECK (wikidata_qid ~ '^Q[0-9]+$'),
  source_id    integer NOT NULL REFERENCES sources (id),
  needs_review boolean NOT NULL DEFAULT false,
  review_notes text
);
CREATE INDEX gold_mines_country_id_idx ON gold_mines (country_id);

COMMENT ON TABLE gold_mines IS
  'Gold mines for the optional map layer; loaded only when the layer passes the quality bar (data/gold_review_report.md).';
COMMENT ON COLUMN gold_mines.id IS 'Surrogate key.';
COMMENT ON COLUMN gold_mines.name IS 'Mine name.';
COMMENT ON COLUMN gold_mines.country_id IS 'The country the mine is in.';
COMMENT ON COLUMN gold_mines.latitude IS 'Latitude (WGS84).';
COMMENT ON COLUMN gold_mines.longitude IS 'Longitude (WGS84).';
COMMENT ON COLUMN gold_mines.status IS 'Operating status as the source states it; NULL when unknown.';
COMMENT ON COLUMN gold_mines.operator IS 'Operator as the source states it; NULL when unknown.';
COMMENT ON COLUMN gold_mines.wikidata_qid IS 'Wikidata item, when the mine comes from Wikidata.';
COMMENT ON COLUMN gold_mines.source_id IS 'The source of the mine''s record.';
COMMENT ON COLUMN gold_mines.needs_review IS 'True while the record is unverified.';
COMMENT ON COLUMN gold_mines.review_notes IS 'Why the record needs review.';
