"""The curated Harim baseline: the `mountainsData` array in harim.html and the peak list in
README.md of github.com/emtatudatatech/harim, at a pinned commit. Both are parsed strictly (a
line that looks like an entry but does not parse fails the run) and kept as raw records; the
reconcile step decides what each one is."""

from __future__ import annotations

import itertools
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from .http import fetch_bytes
from .settings import RAW_DIR

REPO = "emtatudatatech/harim"
RAW_URL = "https://raw.githubusercontent.com/{repo}/{commit}/{path}"
COMMITS_URL = "https://api.github.com/repos/{repo}/commits/{ref}"
CACHE_DIR = RAW_DIR / "harim"


class BaselineError(RuntimeError):
    pass


@dataclass
class BaselineEntry:
    """One peak as the prototype lists it."""

    file: str  # "harim.html" | "README.md"
    raw_name: str
    base_name: str
    qualifier: str | None  # the bracketed part: a range, a summit or another name
    country_text: str
    countries: list[str]  # ISO3 codes of the 54 states
    territory: str | None
    height_m: int
    lat: float | None
    lon: float | None
    notes: str | None = None
    position: int = 0  # order in the file (never used for sorting)
    claims: list[str] = field(default_factory=list)


# How the prototype writes country names that differ from the seeds' names.
COUNTRY_ALIASES = {
    "drc": "COD",
    "democratic republic of congo": "COD",
    "democratic republic of the congo": "COD",
    "cape verde": "CPV",
    "ivory coast": "CIV",
}

# Places in the prototype that are not among the 54 states.
TERRITORIES = {"réunion (france)": "Réunion"}

ENTRY_RE = re.compile(
    r'\{\s*name:\s*"(?P<name>[^"]+)",\s*country:\s*"(?P<country>[^"]+)",\s*'
    r"height:\s*(?P<height>\d+),\s*lat:\s*(?P<lat>-?\d+(?:\.\d+)?),\s*"
    r"long:\s*(?P<lon>-?\d+(?:\.\d+)?)\s*\}"
)
NAME_RE = re.compile(r"^(?P<base>[^()]+?)\s*(?:\((?P<qualifier>[^()]+)\))?$")
README_PEAK_RE = re.compile(r"^\*\s+\*\*(?P<name>[^*]+?):\*\*\s*$")
README_FIELD_RE = re.compile(r"^\s+\*\s+\*\*(?P<key>Height|Location|Notes):\*\*\s*(?P<value>.+)$")


def fold(text: str) -> str:
    """Lower-case, strip accents and punctuation: for matching names only."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", plain).strip()


def split_name(raw: str) -> tuple[str, str | None]:
    match = NAME_RE.match(raw.strip())
    if not match:
        raise BaselineError(f"Cannot split the prototype name {raw!r}")
    qualifier = match.group("qualifier")
    return match.group("base").strip(), qualifier.strip() if qualifier else None


def resolve_countries(text: str, names: dict[str, str]) -> tuple[list[str], str | None]:
    """`"Uganda / DRC"` → (["UGA", "COD"], None); territories → ([], "Réunion")."""
    folded_whole = text.strip().lower()
    if folded_whole in TERRITORIES:
        return [], TERRITORIES[folded_whole]
    codes: list[str] = []
    for part in text.split("/"):
        key = fold(part)
        code = COUNTRY_ALIASES.get(part.strip().lower()) or names.get(key)
        if code is None:
            raise BaselineError(f"Unknown country {part.strip()!r} in the prototype ({text!r})")
        codes.append(code)
    return codes, None


def parse_html(html: str, country_names: dict[str, str]) -> list[BaselineEntry]:
    start = html.find("const mountainsData = [")
    end = html.find("];", start)
    if start == -1 or end == -1:
        raise BaselineError("harim.html: the mountainsData array was not found")
    block = html[start:end]
    candidates = [line for line in block.splitlines() if "name:" in line]
    entries: list[BaselineEntry] = []
    for position, line in enumerate(candidates):
        match = ENTRY_RE.search(line)
        if not match:
            raise BaselineError(f"harim.html: cannot parse entry {line.strip()!r}")
        raw = match.group("name")
        base, qualifier = split_name(raw)
        countries, territory = resolve_countries(match.group("country"), country_names)
        entries.append(
            BaselineEntry(
                file="harim.html",
                raw_name=raw,
                base_name=base,
                qualifier=qualifier,
                country_text=match.group("country"),
                countries=countries,
                territory=territory,
                height_m=int(match.group("height")),
                lat=float(match.group("lat")),
                lon=float(match.group("lon")),
                position=position,
            )
        )
    return entries


def parse_readme(readme: str, country_names: dict[str, str]) -> list[BaselineEntry]:
    entries: list[BaselineEntry] = []
    current: dict[str, str] | None = None
    raw_name = ""

    def flush() -> None:
        if current is None:
            return
        if "Height" not in current or "Location" not in current:
            raise BaselineError(f"README.md: {raw_name!r} lacks a height or location")
        height = re.fullmatch(r"([\d,]+)\s*meters", current["Height"].strip())
        if not height:
            raise BaselineError(f"README.md: cannot read the height of {raw_name!r}")
        base, qualifier = split_name(raw_name)
        countries, territory = resolve_countries(current["Location"], country_names)
        entries.append(
            BaselineEntry(
                file="README.md",
                raw_name=raw_name,
                base_name=base,
                qualifier=qualifier,
                country_text=current["Location"].strip(),
                countries=countries,
                territory=territory,
                height_m=int(height.group(1).replace(",", "")),
                lat=None,
                lon=None,
                notes=current.get("Notes"),
                position=len(entries),
            )
        )

    in_list = False
    for line in readme.splitlines():
        if line.startswith("### African Mountains Featured"):
            in_list = True
            continue
        if in_list and line.startswith("#"):
            break
        if not in_list:
            continue
        peak = README_PEAK_RE.match(line)
        if peak:
            flush()
            raw_name = peak.group("name").strip()
            current = {}
            continue
        field_match = README_FIELD_RE.match(line)
        if field_match and current is not None:
            current[field_match.group("key")] = field_match.group("value").strip()
    flush()
    if not entries:
        raise BaselineError("README.md: no peaks found under 'African Mountains Featured'")
    return entries


@dataclass(frozen=True)
class BaselineSnapshot:
    commit: str
    committed_at: str  # ISO date
    html: str
    readme: str


def resolve_commit(ref: str, *, refresh: bool, cache_dir: Path = CACHE_DIR) -> tuple[str, str]:
    """(sha, commit date) for a branch, tag or sha."""
    body = fetch_bytes(
        COMMITS_URL.format(repo=REPO, ref=ref),
        cache_dir / f"commit-{re.sub(r'[^A-Za-z0-9]', '_', ref)}.json",
        refresh=refresh,
    )
    data = json.loads(body)
    return data["sha"], data["commit"]["committer"]["date"][:10]


def fetch_snapshot(
    ref: str, *, refresh: bool = False, cache_dir: Path = CACHE_DIR
) -> BaselineSnapshot:
    sha, committed_at = resolve_commit(ref, refresh=refresh, cache_dir=cache_dir)
    files = {}
    for path in ("harim.html", "README.md"):
        files[path] = fetch_bytes(
            RAW_URL.format(repo=REPO, commit=sha, path=path),
            cache_dir / sha / path,
            refresh=refresh,
        ).decode("utf-8")
    return BaselineSnapshot(sha, committed_at, files["harim.html"], files["README.md"])


def parse_snapshot(
    snapshot: BaselineSnapshot, country_names: dict[str, str]
) -> list[BaselineEntry]:
    entries = parse_html(snapshot.html, country_names) + parse_readme(
        snapshot.readme, country_names
    )
    # The prototype says its array is sorted by height; record whether that holds (it does not).
    html = [e for e in entries if e.file == "harim.html"]
    for previous, entry in itertools.pairwise(html):
        if entry.height_m > previous.height_m:
            entry.claims.append(
                f"listed after {previous.raw_name} ({previous.height_m} m) although higher, "
                f"so the array is not sorted by height as its comment says"
            )
    return entries
