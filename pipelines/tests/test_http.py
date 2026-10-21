from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from pipelines.africa_pipelines import http
from pipelines.africa_pipelines.settings import USER_AGENT


def client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler)


def test_fetches_once_then_reads_the_cache(tmp_path: Path) -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"<svg/>")

    cache = tmp_path / "ke.svg"
    with client(httpx.MockTransport(handler)) as c:
        assert (
            http.fetch_bytes("https://x.test/ke.svg", cache, client=c, min_interval=0) == b"<svg/>"
        )
        assert (
            http.fetch_bytes("https://x.test/ke.svg", cache, client=c, min_interval=0) == b"<svg/>"
        )
        assert len(calls) == 1
        http.fetch_bytes("https://x.test/ke.svg", cache, client=c, min_interval=0, refresh=True)
        assert len(calls) == 2


def test_retries_server_errors_then_fails_on_client_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("pipelines.africa_pipelines.http.time.sleep", lambda _seconds: None)
    responses = iter([httpx.Response(503), httpx.Response(200, content=b"ok")])
    with client(httpx.MockTransport(lambda _r: next(responses))) as c:
        assert (
            http.fetch_bytes("https://x.test/a", tmp_path / "a", client=c, min_interval=0) == b"ok"
        )
    not_found = httpx.MockTransport(lambda _r: httpx.Response(404))
    with client(not_found) as c, pytest.raises(http.FetchError, match="HTTP 404"):
        http.fetch_bytes("https://x.test/b", tmp_path / "b", client=c, min_interval=0)
    assert not (tmp_path / "b").exists()


def test_requests_identify_the_project(tmp_path: Path) -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["ua"] = request.headers.get("user-agent", "")
        return httpx.Response(200, content=b"x")

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport, headers={"User-Agent": USER_AGENT}) as c:
        http.fetch_bytes("https://x.test/c", tmp_path / "c", client=c, min_interval=0)
    assert seen["ua"].startswith("BaraLaAfrika-pipelines/")


def test_client_errors_carry_the_status_and_the_servers_reason(tmp_path: Path) -> None:
    denied = httpx.MockTransport(
        lambda _r: httpx.Response(401, json={"statusCode": 401, "message": "Access denied."})
    )
    with (
        client(denied) as c,
        pytest.raises(http.FetchError, match=r"HTTP 401 \(Access denied\.\)") as error,
    ):
        http.fetch_bytes("https://x.test/d", tmp_path / "d", client=c, min_interval=0)
    assert error.value.status == 401
