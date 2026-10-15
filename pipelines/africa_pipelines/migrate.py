"""`migrate`: apply the numbered SQL files in db/migrations to the database.

Applied migrations are recorded in `schema_migrations` with a checksum. Each pending migration
runs in its own transaction. An already-applied file whose contents changed is an error (write a
new migration instead of editing an old one).
"""

from __future__ import annotations

import argparse
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .settings import MIGRATIONS_DIR, require_env

FILENAME_RE = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")

SCHEMA_MIGRATIONS_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  filename   text NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE schema_migrations IS 'Migrations applied by `python -m pipelines migrate`.';
"""


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    filename: str
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


class Cursor(Protocol):
    def execute(self, query: str, params: tuple[object, ...] | None = ..., /) -> object: ...
    def fetchall(self) -> list[tuple[object, ...]]: ...


class Connection(Protocol):
    def cursor(self) -> Cursor: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...


def discover(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(directory.glob("*.sql")):
        match = FILENAME_RE.match(path.name)
        if match is None:
            raise MigrationError(f"Bad migration filename {path.name!r} (expected NNNN_name.sql)")
        migrations.append(Migration(match.group(1), path.name, path.read_text(encoding="utf-8")))
    versions = [m.version for m in migrations]
    expected = [f"{n:04d}" for n in range(1, len(migrations) + 1)]
    if versions != expected:
        raise MigrationError(f"Migration numbers must run 0001..n without gaps: {versions}")
    return migrations


def plan(migrations: list[Migration], applied: dict[str, str]) -> list[Migration]:
    """Pending migrations, after checking that applied ones were not edited."""
    known = {m.version for m in migrations}
    unknown = sorted(set(applied) - known)
    if unknown:
        raise MigrationError(f"Database has migrations not present on disk: {unknown}")
    for migration in migrations:
        recorded = applied.get(migration.version)
        if recorded is not None and recorded != migration.checksum:
            raise MigrationError(
                f"{migration.filename} was changed after it was applied. "
                "Add a new migration instead of editing an applied one."
            )
    return [m for m in migrations if m.version not in applied]


def applied_checksums(conn: Connection, *, create: bool = True) -> dict[str, str]:
    """Applied migrations. With create=False (dry runs) nothing is written to the database."""
    cur = conn.cursor()
    if create:
        cur.execute(SCHEMA_MIGRATIONS_DDL)
        conn.commit()
    else:
        cur.execute("SELECT to_regclass('public.schema_migrations') IS NOT NULL")
        if not cur.fetchall()[0][0]:
            return {}
    cur.execute("SELECT version, checksum FROM schema_migrations")
    return {str(v): str(c) for v, c in cur.fetchall()}


def apply(conn: Connection, migrations: list[Migration]) -> list[str]:
    applied: list[str] = []
    for migration in migrations:
        cur = conn.cursor()
        try:
            cur.execute(migration.sql)
            cur.execute(
                "INSERT INTO schema_migrations (version, filename, checksum) VALUES (%s, %s, %s)",
                (migration.version, migration.filename, migration.checksum),
            )
            conn.commit()
        except Exception as error:
            conn.rollback()
            raise MigrationError(
                f"{migration.filename} failed and was rolled back: {error}"
            ) from error
        applied.append(migration.filename)
    return applied


def grant_read_access(conn: Connection, role: str) -> bool:
    """Grant the read-only role SELECT on every table (idempotent). Skipped if the role does not
    exist (e.g. a local throwaway database)."""
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", role):
        raise MigrationError(f"Invalid read-only role name {role!r}")
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
    if not cur.fetchall():
        return False
    cur.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
    cur.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}")
    cur.execute(f"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {role}")
    conn.commit()
    return True


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--dry-run", action="store_true", help="list pending migrations only")
    parser.add_argument(
        "--read-role",
        default="bla_reader",
        help="read-only role to grant SELECT to after migrating (default: bla_reader)",
    )


def run(args: argparse.Namespace) -> int:
    import psycopg

    migrations = discover()
    url = require_env("DATABASE_URL_WRITE", purpose="apply migrations with the write role")
    with psycopg.connect(url) as conn:
        pending = plan(migrations, applied_checksums(conn, create=not args.dry_run))
        if args.dry_run:
            print("Pending: " + (", ".join(m.filename for m in pending) or "none"))
            return 0
        for filename in apply(conn, pending):
            print(f"Applied {filename}")
        if not pending:
            print("Database is up to date.")
        if grant_read_access(conn, args.read_role):
            print(f"Granted read-only access to {args.read_role}.")
        else:
            print(f"Role {args.read_role} not found; skipped read-only grants (see db/roles.sql).")
    return 0
