from __future__ import annotations

import json
from typing import LiteralString

import psycopg

from pipelines.africa_pipelines import gold_load, load, migrate
from pipelines.africa_pipelines.settings import SEEDS_DIR


def migrated(url: str) -> psycopg.Connection[tuple[object, ...]]:
    conn = psycopg.connect(url)
    migrate.apply(conn, migrate.plan(migrate.discover(), migrate.applied_checksums(conn)))
    return conn


def scalar(conn: psycopg.Connection[tuple[object, ...]], query: LiteralString) -> object:
    row = conn.execute(query).fetchone()
    assert row is not None
    return row[0]


def seed_rows(name: str, table: str) -> int:
    data = json.loads((SEEDS_DIR / name).read_text(encoding="utf-8"))
    return len(data[table]["rows"])


def test_gold_seeds_load_completely_and_reload_with_no_changes(pglite_url: str) -> None:
    with migrated(pglite_url) as conn:
        first = load.load(conn)
        assert first.changes["gold_price_monthly"] == seed_rows("gold_price.json", "prices")
        assert scalar(conn, "SELECT count(*) FROM gold_official_reserves") == seed_rows(
            "gold_reserves.json", "reserves"
        )
        assert scalar(conn, "SELECT count(*) FROM gold_production_annual") == seed_rows(
            "gold_production.json", "production"
        )
        assert scalar(conn, "SELECT count(*) FROM gold_trade_partners") == seed_rows(
            "gold_trade.json", "partners"
        )
        assert scalar(conn, "SELECT count(*) FROM country_gold_profiles") == 54
        # The mines layer did not pass its quality bar, so nothing is loaded.
        mines = json.loads((SEEDS_DIR / "gold_mines.json").read_text(encoding="utf-8"))
        expected_mines = len(mines["mines"]["rows"]) if mines["layer_enabled"] else 0
        assert scalar(conn, "SELECT count(*) FROM gold_mines") == expected_mines
        runs = {
            str(key): str(status)
            for key, status in conn.execute(
                "SELECT d.key, r.status::text FROM ingestion_runs r "
                "JOIN datasets d ON d.id = r.dataset_id WHERE d.key LIKE 'gold-%'"
            ).fetchall()
        }
        assert set(runs.values()) == {"succeeded"}
        assert "gold-price" in runs and "gold-trade" in runs

        second = load.load(conn)
        gold_tables = {t for tables in gold_load.DATASET_TABLES.values() for t in tables}
        assert {t: n for t, n in second.changes.items() if t in gold_tables and n} == {}


def test_production_view_values_each_year_at_its_own_mean_price(pglite_url: str) -> None:
    with migrated(pglite_url) as conn:
        load.load(conn)
        row = conn.execute(
            """
            SELECT p.tonnes, p.value_usd, p.price_usd_per_troy_oz, a.mean_usd_per_troy_oz,
                   p.value_is_computed
            FROM v_gold_production p JOIN countries c ON c.id = p.country_id
            JOIN v_gold_price_annual a ON a.year = p.year
            WHERE c.iso3 = 'GHA' AND p.year = 2024
            """
        ).fetchone()
        assert row is not None
        tonnes, value, price, annual_mean, computed = row
        assert price == annual_mean
        assert computed is True
        assert abs(float(str(value)) - float(str(tonnes)) * 32150.7466 * float(str(price))) < 1
        # Mine production rows never value a year without all twelve monthly prices.
        assert (
            scalar(
                conn,
                "SELECT count(*) FROM v_gold_production p JOIN v_gold_price_annual a "
                "ON a.year = p.year WHERE NOT a.is_complete AND p.value_usd IS NOT NULL",
            )
            == 0
        )
