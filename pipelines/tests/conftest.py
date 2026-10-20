from __future__ import annotations

import os
import shutil
import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[2]
PGLITE_SERVER = ROOT / "node_modules/@electric-sql/pglite-socket/dist/scripts/server.js"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture
def pglite_url() -> Iterator[str]:
    """A fresh in-memory Postgres (PGlite over the wire protocol) for one test."""
    node = shutil.which("node")
    if node is None or not PGLITE_SERVER.exists():
        pytest.skip("PGlite socket server unavailable (run `npm install`)")
    port = _free_port()
    process = subprocess.Popen(
        [node, str(PGLITE_SERVER), f"--port={port}", "--host=127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={**os.environ},
    )
    url = f"postgresql://postgres:postgres@127.0.0.1:{port}/postgres?sslmode=disable"
    try:
        # Ready when a real client session succeeds (the server serves one connection at a time,
        # so a bare TCP probe can still be occupying it).
        deadline = time.monotonic() + 30
        while True:
            try:
                with psycopg.connect(url, connect_timeout=2) as probe:
                    probe.execute("SELECT 1")
                break
            except psycopg.OperationalError:
                if time.monotonic() > deadline:
                    pytest.fail("PGlite socket server did not start")
                time.sleep(0.2)
        yield url
    finally:
        process.terminate()
        process.wait(timeout=10)
