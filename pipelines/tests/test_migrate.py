from __future__ import annotations

import argparse
from pathlib import Path

import psycopg
import pytest

from pipelines.africa_pipelines import migrate


def write(directory: Path, name: str, sql: str = "SELECT 1;") -> None:
    (directory / name).write_text(sql)


def test_discover_requires_contiguous_well_named_files(tmp_path: Path) -> None:
    write(tmp_path, "0001_first.sql")
    write(tmp_path, "0003_third.sql")
    with pytest.raises(migrate.MigrationError, match="without gaps"):
        migrate.discover(tmp_path)
    (tmp_path / "0003_third.sql").unlink()
    write(tmp_path, "2_bad.sql")
    with pytest.raises(migrate.MigrationError, match="Bad migration filename"):
        migrate.discover(tmp_path)


def test_plan_detects_edited_and_unknown_migrations() -> None:
    first = migrate.Migration("0001", "0001_a.sql", "SELECT 1;")
    second = migrate.Migration("0002", "0002_b.sql", "SELECT 2;")
    assert migrate.plan([first, second], {"0001": first.checksum}) == [second]
    with pytest.raises(migrate.MigrationError, match="changed after it was applied"):
        migrate.plan([first], {"0001": "different"})
    with pytest.raises(migrate.MigrationError, match="not present on disk"):
        migrate.plan([first], {"0001": first.checksum, "0009": "x"})


def test_repository_migrations_are_discoverable() -> None:
    migrations = migrate.discover()
    assert migrations[0].filename == "0001_core.sql"


def test_migrate_applies_once_and_rolls_back_failures(
    pglite_url: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL_WRITE", pglite_url)
    args = argparse.Namespace(dry_run=False, read_role="bla_reader")
    assert migrate.run(args) == 0
    assert "Applied 0001_core.sql" in capsys.readouterr().out
    assert migrate.run(args) == 0
    assert "up to date" in capsys.readouterr().out

    with psycopg.connect(pglite_url) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
            ).fetchall()
        }
        assert {"regions", "countries", "country_profiles", "sources", "datasets"} <= tables

        broken = migrate.Migration("0002", "0002_broken.sql", "CREATE TABLE x (id int); SELEC 1;")
        with pytest.raises(migrate.MigrationError, match="rolled back"):
            migrate.apply(conn, [broken])
        exists = conn.execute("SELECT to_regclass('public.x') IS NOT NULL").fetchone()
        assert exists == (False,)


def test_grants_read_access_when_the_role_exists(pglite_url: str) -> None:
    with psycopg.connect(pglite_url) as conn:
        migrate.apply(conn, migrate.plan(migrate.discover(), migrate.applied_checksums(conn)))
        assert migrate.grant_read_access(conn, "bla_reader") is False
        conn.execute("CREATE ROLE bla_reader")
        conn.commit()
        assert migrate.grant_read_access(conn, "bla_reader") is True
        allowed = conn.execute(
            "SELECT has_table_privilege('bla_reader', 'countries', 'SELECT'), "
            "has_table_privilege('bla_reader', 'countries', 'INSERT')"
        ).fetchone()
        assert allowed == (True, False)
        with pytest.raises(migrate.MigrationError, match="Invalid read-only role"):
            migrate.grant_read_access(conn, "bad; role")


def test_dry_run_writes_nothing(
    pglite_url: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL_WRITE", pglite_url)
    assert migrate.run(argparse.Namespace(dry_run=True, read_role="bla_reader")) == 0
    assert "Pending: 0001_core.sql" in capsys.readouterr().out
    with psycopg.connect(pglite_url) as conn:
        assert conn.execute("SELECT to_regclass('public.schema_migrations')").fetchone() == (None,)
