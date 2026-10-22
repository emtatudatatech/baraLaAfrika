-- 0011_indicators.sql
-- Vinara's annual indicators: a general model of indicators and their yearly observations per
-- country, plus public external debt by creditor. Sources and licences:
-- docs/vinara-sources.md; rules: docs/vinara-method.md.
--
-- Conventions (enforced here and in the pipeline's validation):
--   * one value per indicator, country and year; NULL is never stored: a missing figure is a
--     missing row, never zero;
--   * money is nominal (current) US dollars or current international dollars (PPP), as each
--     indicator's unit says;
--   * projections are never stored; an IMF figure for the year before its WEO edition is
--     basis 'estimate'.

CREATE TYPE observation_basis AS ENUM ('reported', 'estimate');
COMMENT ON TYPE observation_basis IS
  'reported: the figure as the source publishes it for a past year; estimate: an IMF World Economic Outlook figure for the year before the edition (an IMF staff estimate), used only where the primary source has none.';

CREATE TYPE creditor_kind AS ENUM (
  'multilateral', 'bilateral', 'bondholders', 'commercial_banks', 'other_private'
);
COMMENT ON TYPE creditor_kind IS
  'Who a public external debt is owed to, as the World Bank''s International Debt Statistics group creditors.';

-- ── indicators ───────────────────────────────────────────────────────────────

CREATE TABLE indicators (
  id          serial PRIMARY KEY,
  key         text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name        text NOT NULL,
  unit        text NOT NULL CHECK (
                unit IN ('people', 'percent', 'km2', 'current_usd', 'current_intl_usd',
                         'percent_of_gdp', 'index')),
  decimals    smallint NOT NULL CHECK (decimals BETWEEN 0 AND 6),
  definition  text NOT NULL,
  source_code text,
  dataset_id  integer NOT NULL REFERENCES datasets (id),
  sort_order  smallint NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER indicators_set_updated_at BEFORE UPDATE ON indicators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE indicators IS
  'An annual country indicator (population, GDP, inflation…): what it measures and where it comes from.';
COMMENT ON COLUMN indicators.id IS 'Surrogate key.';
COMMENT ON COLUMN indicators.key IS 'Stable key used by the API, e.g. "gdp_ppp".';
COMMENT ON COLUMN indicators.name IS 'Display name.';
COMMENT ON COLUMN indicators.unit IS
  'people, percent, km2, current_usd (nominal US dollars), current_intl_usd (international dollars at purchasing power parity), percent_of_gdp or index.';
COMMENT ON COLUMN indicators.decimals IS 'Decimal places the values are stored and shown with.';
COMMENT ON COLUMN indicators.definition IS 'What the indicator measures, as the site shows it.';
COMMENT ON COLUMN indicators.source_code IS
  'The series code at the source (e.g. a World Bank indicator code), for traceability.';
COMMENT ON COLUMN indicators.dataset_id IS 'The dataset the observations come from.';
COMMENT ON COLUMN indicators.sort_order IS 'Display order.';
COMMENT ON COLUMN indicators.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN indicators.updated_at IS 'When the row last changed.';

-- ── indicator_observations ───────────────────────────────────────────────────

CREATE TABLE indicator_observations (
  indicator_id integer NOT NULL REFERENCES indicators (id) ON DELETE CASCADE,
  country_id   integer NOT NULL REFERENCES countries (id),
  year         smallint NOT NULL CHECK (year BETWEEN 1960 AND 2100),
  value        numeric NOT NULL,
  basis        observation_basis NOT NULL DEFAULT 'reported',
  source_id    integer NOT NULL REFERENCES sources (id),
  edition      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (indicator_id, country_id, year)
);
CREATE INDEX indicator_observations_country ON indicator_observations (country_id, indicator_id);
CREATE TRIGGER indicator_observations_set_updated_at BEFORE UPDATE ON indicator_observations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE indicator_observations IS
  'One value of an indicator for a country and year. A missing figure is a missing row, never zero.';
COMMENT ON COLUMN indicator_observations.indicator_id IS 'The indicator.';
COMMENT ON COLUMN indicator_observations.country_id IS 'The country.';
COMMENT ON COLUMN indicator_observations.year IS 'Calendar year the value refers to.';
COMMENT ON COLUMN indicator_observations.value IS 'The value, in the indicator''s unit.';
COMMENT ON COLUMN indicator_observations.basis IS
  'reported, or estimate (an IMF figure for the year before its WEO edition, used where the primary source has none).';
COMMENT ON COLUMN indicator_observations.source_id IS 'Where the value comes from.';
COMMENT ON COLUMN indicator_observations.edition IS
  'The source''s edition or update the value was read from, e.g. "World Bank WDI, updated 2026-10-08".';
COMMENT ON COLUMN indicator_observations.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN indicator_observations.updated_at IS 'When the row last changed.';

-- ── external_debt_creditors ──────────────────────────────────────────────────

CREATE TABLE external_debt_creditors (
  country_id    integer NOT NULL REFERENCES countries (id),
  year          smallint NOT NULL CHECK (year BETWEEN 1970 AND 2100),
  creditor_kind creditor_kind NOT NULL,
  creditor_code text NOT NULL,
  creditor_name text NOT NULL,
  amount_usd    numeric(18, 1) NOT NULL CHECK (amount_usd > 0),
  source_id     integer NOT NULL REFERENCES sources (id),
  edition       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_id, year, creditor_kind, creditor_code)
);
CREATE TRIGGER external_debt_creditors_set_updated_at BEFORE UPDATE ON external_debt_creditors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE external_debt_creditors IS
  'Public and publicly guaranteed external debt outstanding at the end of a year, by creditor ("major lenders"). Only creditors with a positive amount are stored.';
COMMENT ON COLUMN external_debt_creditors.country_id IS 'The borrowing country.';
COMMENT ON COLUMN external_debt_creditors.year IS 'Year-end the amount refers to.';
COMMENT ON COLUMN external_debt_creditors.creditor_kind IS
  'Multilateral institution, another government (bilateral), bondholders, commercial banks or other private lenders.';
COMMENT ON COLUMN external_debt_creditors.creditor_code IS
  'The World Bank''s counterpart code for the creditor (BND for bondholders).';
COMMENT ON COLUMN external_debt_creditors.creditor_name IS
  'The creditor: an institution, a country (for banks and other private lenders, the lenders'' country) or "Bondholders".';
COMMENT ON COLUMN external_debt_creditors.amount_usd IS 'Debt outstanding, current US dollars.';
COMMENT ON COLUMN external_debt_creditors.source_id IS 'Where the figure comes from (International Debt Statistics).';
COMMENT ON COLUMN external_debt_creditors.edition IS 'The source update the figure was read from.';
COMMENT ON COLUMN external_debt_creditors.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN external_debt_creditors.updated_at IS 'When the row last changed.';
