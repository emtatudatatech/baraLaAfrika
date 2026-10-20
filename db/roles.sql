-- db/roles.sql — run ONCE per database (and per Neon branch), as the database owner
-- (e.g. neondb_owner in the Neon SQL editor), before the first `python -m pipelines migrate`.
-- Replace the passwords, then put the resulting connection strings in:
--   bla_reader → DATABASE_URL_READ   (Netlify site environment variables; functions only)
--   bla_writer → DATABASE_URL_WRITE  (local .env and GitHub Actions secrets; pipelines only)
--
-- The write role owns the schema objects it creates through migrations. After every migrate,
-- the runner (connected as bla_writer) grants SELECT on all tables and EXECUTE on functions to
-- bla_reader, so the read-only role can read new tables without extra steps here.

CREATE ROLE bla_writer WITH LOGIN PASSWORD 'change-me-writer';
CREATE ROLE bla_reader WITH LOGIN PASSWORD 'change-me-reader';

-- Writer: create and change objects in the public schema (migrations and data loads).
GRANT USAGE, CREATE ON SCHEMA public TO bla_writer;

-- Reader: may look up objects in public; table privileges are granted by the migrate command.
GRANT USAGE ON SCHEMA public TO bla_reader;

-- Belt and braces: the reader can never write, even if a later grant is too broad.
ALTER ROLE bla_reader SET default_transaction_read_only = on;
