-- 0012_politics.sql
-- Vinara's leaders and next national elections, as approved from Wikipedia's lists (with
-- Wikidata as a cross-check), and election_status(), which computes a country's election
-- status from today's date each time it is read. Sources: docs/vinara-sources.md; rules:
-- docs/vinara-method.md (Leaders and elections).

CREATE TYPE leader_role AS ENUM (
  'head_of_state', 'head_of_government', 'head_of_state_and_government'
);
COMMENT ON TYPE leader_role IS
  'Which office a leader holds: head of state, head of government, or both (one person).';

CREATE TYPE election_kind AS ENUM ('presidential', 'legislative', 'general');
COMMENT ON TYPE election_kind IS
  'presidential, legislative (parliamentary), or general (both on the same day).';

CREATE TYPE election_decides AS ENUM ('presidential', 'legislative', 'none');
COMMENT ON TYPE election_decides IS
  'Which election decides the executive: the presidential election where the executive president is elected, otherwise the legislative election; none where no national election is held.';

CREATE TYPE date_precision AS ENUM ('day', 'month', 'year');
COMMENT ON TYPE date_precision IS
  'How precisely a date is known. A month or year alone is stored as its last day.';

-- ── country_leaders ──────────────────────────────────────────────────────────

CREATE TABLE country_leaders (
  country_id     integer NOT NULL REFERENCES countries (id),
  position       smallint NOT NULL CHECK (position IN (1, 2)),
  role           leader_role NOT NULL,
  title          text NOT NULL,
  person_name    text NOT NULL,
  wikipedia_article text,
  wikidata_qid   text CHECK (wikidata_qid ~ '^Q[0-9]+$'),
  is_executive   boolean NOT NULL,
  is_transitional boolean NOT NULL DEFAULT false,
  is_de_facto    boolean NOT NULL DEFAULT false,
  source_id      integer NOT NULL REFERENCES sources (id),
  approved_on    date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_id, position),
  CHECK ((position = 1) = is_executive)
);
CREATE TRIGGER country_leaders_set_updated_at BEFORE UPDATE ON country_leaders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE country_leaders IS
  'Who leads each country: the office holding executive power first, then the other of head of state and head of government where it is a different person.';
COMMENT ON COLUMN country_leaders.country_id IS 'The country.';
COMMENT ON COLUMN country_leaders.position IS '1: the executive leader; 2: the other office holder.';
COMMENT ON COLUMN country_leaders.role IS 'Head of state, head of government, or both.';
COMMENT ON COLUMN country_leaders.title IS 'The office as the source names it (President, King, Prime Minister, Transitional President…).';
COMMENT ON COLUMN country_leaders.person_name IS 'The office holder''s name.';
COMMENT ON COLUMN country_leaders.wikipedia_article IS 'The office holder''s English Wikipedia article, when the source links one.';
COMMENT ON COLUMN country_leaders.wikidata_qid IS 'The office holder''s Wikidata item.';
COMMENT ON COLUMN country_leaders.is_executive IS 'True for the office holding executive power (position 1).';
COMMENT ON COLUMN country_leaders.is_transitional IS 'True for an acting, interim or transitional office holder, or a military transition''s leader.';
COMMENT ON COLUMN country_leaders.is_de_facto IS 'True where the holder exercises power without its constitutional basis, as the source marks it.';
COMMENT ON COLUMN country_leaders.source_id IS 'Where the record comes from.';
COMMENT ON COLUMN country_leaders.approved_on IS 'When the project owner approved the record.';
COMMENT ON COLUMN country_leaders.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN country_leaders.updated_at IS 'When the row last changed.';

-- ── country_elections ────────────────────────────────────────────────────────

CREATE TABLE country_elections (
  country_id     integer PRIMARY KEY REFERENCES countries (id),
  decides        election_decides NOT NULL,
  kind           election_kind,
  next_date      date,
  next_precision date_precision,
  next_article   text,
  last_date      date,
  last_precision date_precision,
  last_article   text,
  note           text,
  source_id      integer NOT NULL REFERENCES sources (id),
  approved_on    date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((decides = 'none') = (kind IS NULL)),
  CHECK ((next_date IS NULL) = (next_precision IS NULL)),
  CHECK ((last_date IS NULL) = (last_precision IS NULL))
);
CREATE TRIGGER country_elections_set_updated_at BEFORE UPDATE ON country_elections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE country_elections IS
  'Each country''s next national election that decides the executive, and the last one. A country without a scheduled date has next_date NULL.';
COMMENT ON COLUMN country_elections.country_id IS 'The country.';
COMMENT ON COLUMN country_elections.decides IS 'Whether the presidential or the legislative election decides the executive (none: no national elections).';
COMMENT ON COLUMN country_elections.kind IS 'The next election''s kind (general: presidential and legislative together).';
COMMENT ON COLUMN country_elections.next_date IS 'The next election''s date; for a month or year alone, its last day (the latest possible date).';
COMMENT ON COLUMN country_elections.next_precision IS 'Whether next_date is a day, or stands for a month or a year.';
COMMENT ON COLUMN country_elections.next_article IS 'The English Wikipedia article on the next election, when there is one.';
COMMENT ON COLUMN country_elections.last_date IS 'The last such election''s date.';
COMMENT ON COLUMN country_elections.last_precision IS 'Whether last_date is a day, or stands for a month or a year.';
COMMENT ON COLUMN country_elections.last_article IS 'The English Wikipedia article on the last election.';
COMMENT ON COLUMN country_elections.note IS 'Context shown with the country (a disputed term, rival authorities…), from a quoted source.';
COMMENT ON COLUMN country_elections.source_id IS 'Where the record comes from.';
COMMENT ON COLUMN country_elections.approved_on IS 'When the project owner approved the record.';
COMMENT ON COLUMN country_elections.created_at IS 'When the row was first loaded.';
COMMENT ON COLUMN country_elections.updated_at IS 'When the row last changed.';

-- ── election_status ──────────────────────────────────────────────────────────

CREATE FUNCTION election_status(p_next_date date, p_today date DEFAULT current_date)
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    -- No date, or a listed date that has passed before the source caught up.
    WHEN p_next_date IS NULL OR p_next_date < p_today THEN 'no_date_set'
    WHEN p_next_date <= (p_today + interval '12 months')::date THEN 'within_12_months'
    ELSE 'beyond_12_months'
  END
$$;
COMMENT ON FUNCTION election_status(date, date) IS
  'within_12_months ("Election within 12 months"), beyond_12_months ("No election within 12 months") or no_date_set ("No date set"), counted from p_today (today unless given).';
