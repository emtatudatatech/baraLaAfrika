-- 0014_fx.sql
-- Vinara's exchange rates from 2020: each state's currency and peg, its currency changes, the
-- IMF's monthly rates (local currency per US dollar, on today's unit) and official daily rates
-- (the ECB's reference rates and rates derived from them, the BIS, and central banks). Sources: docs/vinara-sources.md (§4–5); rules: docs/vinara-method.md.

CREATE TYPE fx_status AS ENUM ('current', 'late', 'stale', 'none');
COMMENT ON TYPE fx_status IS
  'How recent a country''s monthly series is: current (at most 3 months behind the newest month in the data), late (up to 12), stale (more than 12), none (no series).';

CREATE TYPE fx_daily_basis AS ENUM ('ecb', 'derived', 'bis', 'central_bank');
COMMENT ON TYPE fx_daily_basis IS
  'ecb: the ECB''s own reference rate; derived: computed from the ECB''s rates at an official parity; bis: the BIS''s daily rate; central_bank: the state''s own central bank, as published.';

CREATE TYPE currency_change_handling AS ENUM ('converted', 'already_on_new_unit', 'outside_series');
COMMENT ON TYPE currency_change_handling IS
  'How a currency change was applied to the IMF series: converted (earlier months divided by the official conversion), already_on_new_unit (the IMF had done it), outside_series (the change falls outside the months covered).';

-- ── country_currencies ───────────────────────────────────────────────────────

CREATE TABLE country_currencies (
  country_id    integer PRIMARY KEY REFERENCES countries (id),
  currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  union_name    text,
  peg_anchor    char(3) CHECK (peg_anchor IN ('EUR', 'USD', 'ZAR')),
  peg_parity    numeric CHECK (peg_parity > 0),
  peg_since     date,
  source_id     integer REFERENCES sources (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((peg_anchor IS NULL) = (peg_parity IS NULL)),
  CHECK ((peg_anchor IS NULL) = (peg_since IS NULL))
);
CREATE TRIGGER country_currencies_set_updated_at BEFORE UPDATE ON country_currencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE country_currencies IS
  'Each state''s currency today (ISO 4217) and, where it has one, its official fixed parity.';
COMMENT ON COLUMN country_currencies.country_id IS 'The country.';
COMMENT ON COLUMN country_currencies.currency_code IS 'ISO 4217 code of the currency in use today.';
COMMENT ON COLUMN country_currencies.union_name IS 'The currency union, for the CFA francs (one currency shared by several states).';
COMMENT ON COLUMN country_currencies.peg_anchor IS 'The currency it is fixed to (EUR, USD or ZAR), if any.';
COMMENT ON COLUMN country_currencies.peg_parity IS 'Units of this currency per unit of the anchor.';
COMMENT ON COLUMN country_currencies.peg_since IS 'Since when the parity has held.';
COMMENT ON COLUMN country_currencies.source_id IS 'Where the peg is recorded (the IMF''s AREAER); NULL without a peg.';
COMMENT ON COLUMN country_currencies.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN country_currencies.updated_at IS 'When the row last changed.';

-- ── currency_changes ─────────────────────────────────────────────────────────

CREATE TABLE currency_changes (
  country_id     integer NOT NULL REFERENCES countries (id),
  effective_date date NOT NULL,
  old_code       char(3) NOT NULL,
  new_code       char(3) NOT NULL,
  old_per_new    numeric NOT NULL CHECK (old_per_new > 0),
  note           text NOT NULL,
  handling       currency_change_handling NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_id, effective_date)
);
CREATE TRIGGER currency_changes_set_updated_at BEFORE UPDATE ON currency_changes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE currency_changes IS
  'Currency changes (redenominations and new currencies) with their official conversion. A change is never read as a gain or a loss.';
COMMENT ON COLUMN currency_changes.country_id IS 'The country.';
COMMENT ON COLUMN currency_changes.effective_date IS 'When the new currency took effect.';
COMMENT ON COLUMN currency_changes.old_code IS 'ISO 4217 code of the old currency.';
COMMENT ON COLUMN currency_changes.new_code IS 'ISO 4217 code of the new currency.';
COMMENT ON COLUMN currency_changes.old_per_new IS 'Official conversion: old units per new unit.';
COMMENT ON COLUMN currency_changes.note IS 'The change in words.';
COMMENT ON COLUMN currency_changes.handling IS 'How the change was applied to the monthly series.';
COMMENT ON COLUMN currency_changes.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN currency_changes.updated_at IS 'When the row last changed.';

-- ── fx_monthly ───────────────────────────────────────────────────────────────

CREATE TABLE fx_monthly (
  country_id  integer NOT NULL REFERENCES countries (id),
  month       date NOT NULL CHECK (month = date_trunc('month', month)::date),
  per_usd_avg numeric CHECK (per_usd_avg > 0),
  per_usd_end numeric CHECK (per_usd_end > 0),
  converted   boolean NOT NULL DEFAULT false,
  source_id   integer NOT NULL REFERENCES sources (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_id, month),
  CHECK (per_usd_avg IS NOT NULL OR per_usd_end IS NOT NULL)
);
CREATE TRIGGER fx_monthly_set_updated_at BEFORE UPDATE ON fx_monthly
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fx_monthly IS
  'Monthly exchange rates, local currency per US dollar, on today''s currency unit (IMF Exchange Rates).';
COMMENT ON COLUMN fx_monthly.country_id IS 'The country.';
COMMENT ON COLUMN fx_monthly.month IS 'First day of the month.';
COMMENT ON COLUMN fx_monthly.per_usd_avg IS 'Average over the month.';
COMMENT ON COLUMN fx_monthly.per_usd_end IS 'At the end of the month.';
COMMENT ON COLUMN fx_monthly.converted IS 'True when the IMF gave the old unit and the value was converted at the official conversion.';
COMMENT ON COLUMN fx_monthly.source_id IS 'Where the rate comes from.';
COMMENT ON COLUMN fx_monthly.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN fx_monthly.updated_at IS 'When the row last changed.';

-- ── fx_daily ─────────────────────────────────────────────────────────────────

CREATE TABLE fx_daily (
  currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  day           date NOT NULL,
  per_usd       numeric NOT NULL CHECK (per_usd > 0),
  basis         fx_daily_basis NOT NULL,
  source_id     integer NOT NULL REFERENCES sources (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency_code, day)
);
CREATE TRIGGER fx_daily_set_updated_at BEFORE UPDATE ON fx_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fx_daily IS
  'Official daily rates from 2020, units per US dollar, for currencies with a daily source usable without permission: the ECB (the rand, and the currencies fixed to the euro, the rand or the dollar, derived at their parities), the BIS, and central banks. Per currency: states sharing a currency share its rates.';
COMMENT ON COLUMN fx_daily.currency_code IS 'ISO 4217 code.';
COMMENT ON COLUMN fx_daily.day IS 'The date the rate was published for.';
COMMENT ON COLUMN fx_daily.per_usd IS 'Units per US dollar.';
COMMENT ON COLUMN fx_daily.basis IS 'The ECB''s own rate, derived from it at an official parity, the BIS''s, or the central bank''s own.';
COMMENT ON COLUMN fx_daily.source_id IS 'Where the rate comes from.';
COMMENT ON COLUMN fx_daily.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN fx_daily.updated_at IS 'When the row last changed.';

-- ── fx_reporting ─────────────────────────────────────────────────────────────

CREATE TABLE fx_reporting (
  country_id    integer PRIMARY KEY REFERENCES countries (id),
  first_month   date,
  last_month    date,
  months_behind integer CHECK (months_behind >= 0),
  status        fx_status NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER fx_reporting_set_updated_at BEFORE UPDATE ON fx_reporting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fx_reporting IS 'How far each state''s monthly series reaches.';
COMMENT ON COLUMN fx_reporting.country_id IS 'The country.';
COMMENT ON COLUMN fx_reporting.first_month IS 'First month with a rate.';
COMMENT ON COLUMN fx_reporting.last_month IS 'Last month with a rate.';
COMMENT ON COLUMN fx_reporting.months_behind IS 'Months between its last month and the newest month in the data.';
COMMENT ON COLUMN fx_reporting.status IS 'current, late, stale or none.';
COMMENT ON COLUMN fx_reporting.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN fx_reporting.updated_at IS 'When the row last changed.';
