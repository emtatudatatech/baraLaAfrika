"""Polite HTTP fetching for pipelines: descriptive User-Agent, a minimum interval between
requests to the same host, retries with backoff on 429/5xx, and an on-disk cache so re-runs
do not re-download (pass refresh=True to fetch again)."""

from __future__ import annotations

import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .settings import USER_AGENT

MIN_INTERVAL_SECONDS = 1.0
MAX_ATTEMPTS = 4
_last_request_at: dict[str, float] = {}


class FetchError(RuntimeError):
    """A download failed; `status` is the HTTP status when the server answered."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _error_detail(response: httpx.Response) -> str:
    """The server's own short explanation of an error (its JSON `message`), if any."""
    try:
        payload = response.json()
    except ValueError:
        return ""
    if isinstance(payload, dict):
        message = payload.get("message") or payload.get("error")
        if isinstance(message, str) and message.strip():
            return f" ({' '.join(message.split())[:200]})"
    return ""


def _wait_for_slot(host: str, min_interval: float) -> None:
    last = _last_request_at.get(host)
    if last is not None:
        delay = min_interval - (time.monotonic() - last)
        if delay > 0:
            time.sleep(delay)
    _last_request_at[host] = time.monotonic()


def fetch_bytes(
    url: str,
    cache_path: Path,
    *,
    refresh: bool = False,
    min_interval: float = MIN_INTERVAL_SECONDS,
    timeout: float = 30.0,
    client: httpx.Client | None = None,
    headers: dict[str, str] | None = None,
) -> bytes:
    """Return the body of `url`, reading from `cache_path` when present (unless refresh).

    `headers` are sent with the request only (an API key, say); they are never cached or logged.
    """
    if cache_path.exists() and not refresh:
        return cache_path.read_bytes()
    host = urlparse(url).hostname or ""
    owns_client = client is None
    http = client or httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=timeout, follow_redirects=True
    )
    try:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            _wait_for_slot(host, min_interval)
            try:
                response = http.get(url, headers=headers)
            except httpx.TransportError as error:
                if attempt == MAX_ATTEMPTS:
                    raise FetchError(f"{url}: {error}") from error
                time.sleep(2**attempt)
                continue
            if response.status_code == 200:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_bytes(response.content)
                return response.content
            if response.status_code in {429, 500, 502, 503, 504} and attempt < MAX_ATTEMPTS:
                retry_after = response.headers.get("retry-after", "")
                time.sleep(float(retry_after) if retry_after.isdigit() else 2**attempt)
                continue
            raise FetchError(
                f"{url}: HTTP {response.status_code}{_error_detail(response)}",
                status=response.status_code,
            )
        raise FetchError(f"{url}: gave up after {MAX_ATTEMPTS} attempts")
    finally:
        if owns_client:
            http.close()
