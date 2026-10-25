"""`python -m pipelines politics`: Vinara's leaders and next elections into db/seeds/politics.json,
with data/politics_review_report.md.

Leaders come from Wikipedia's "List of current heads of state and government", which marks the
office that holds executive power; elections from its "List of next general elections". Each
person's Wikidata ID is read from their article, and Wikidata's own head-of-state and
head-of-government statements are compared as a second opinion. Political data changes, and
both lists can be edited by anyone: the site shows the snapshot approved in
reference/politics_approved.json, and every difference from it is listed in the report until it
is approved (`--approve`).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from dataclasses import asdict, dataclass, field
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .gold_common import SourceRecord, countries, table, write_seed
from .http import fetch_bytes
from .politics_wikitext import (
    COMMENT_RE,
    LINK_RE,
    ElectionCell,
    ElectionRow,
    Office,
    parse_elections,
    parse_leaders,
)
from .settings import DATA_DIR, RAW_DIR, SEEDS_DIR
from .wikidata import sparql

REFERENCE = Path(__file__).parent / "reference"
CURATION_FILE = REFERENCE / "politics_curation.json"
APPROVED_FILE = REFERENCE / "politics_approved.json"
POLITICS_SEED = SEEDS_DIR / "politics.json"
REPORT_PATH = DATA_DIR / "politics_review_report.md"
POLITICS_RAW = RAW_DIR / "politics"

WIKIDATA = SourceRecord(
    "wikidata-leaders", "Wikidata: heads of state and government", "https://www.wikidata.org/"
)


class PoliticsError(RuntimeError):
    pass


class PoliticsValidationError(PoliticsError):
    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("\n".join(f"  - {p}" for p in problems))


@cache
def curation() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(CURATION_FILE.read_text(encoding="utf-8"))
    return data


def list_name(iso3: str, which: str) -> str:
    names = curation()["names"].get(iso3, {})
    return str(names.get(which, next(c.name for c in countries() if c.iso3 == iso3)))


def source_record(which: str) -> SourceRecord:
    spec = curation()["sources"][which]
    url = "https://en.wikipedia.org/wiki/" + quote(spec["page"].replace(" ", "_"))
    return SourceRecord(
        spec["source_key"],
        spec["title"],
        url,
        source_type="encyclopedia",
        reliability_tier="reference",
    )


# ── Records ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Leader:
    iso3: str
    position: int  # 1 = the executive; 2 = the other of head of state and head of government
    role: str  # head_of_state | head_of_government | head_of_state_and_government
    title: str
    person: str
    article: str | None
    wikidata_qid: str | None
    executive: bool
    transitional: bool
    de_facto: bool


@dataclass(frozen=True)
class Election:
    iso3: str
    decides: str  # presidential | legislative | none
    kind: str | None  # presidential | legislative | general
    next_date: str | None
    next_precision: str | None  # day | month | year (month/year: the latest possible date)
    next_article: str | None
    last_date: str | None
    last_precision: str | None
    last_article: str | None


@dataclass
class Result:
    leaders: list[Leader]
    elections: list[Election]
    notes: dict[str, str]
    revisions: dict[str, int]  # source key → Wikipedia revision read
    approved: dict[str, Any] | None
    changes: list[str] = field(default_factory=list)  # differences from the approved snapshot
    wikidata_differences: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    today: dt.date = field(default_factory=dt.date.today)


# ── Fetching ─────────────────────────────────────────────────────────────────


def fetch_page(which: str, *, refresh: bool) -> tuple[str, int]:
    page = curation()["sources"][which]["page"]
    url = curation()["api"].format(page=quote(page))
    payload = json.loads(
        fetch_bytes(url, POLITICS_RAW / f"{which}.json", refresh=refresh, timeout=60)
    )
    if "error" in payload:
        raise PoliticsError(f"Wikipedia: {payload['error'].get('info', payload['error'])}")
    return str(payload["parse"]["wikitext"]), int(payload["parse"]["revid"])


def wikidata_ids(articles: list[str], *, refresh: bool) -> dict[str, str]:
    """Each article's Wikidata item, through redirects (Wikipedia's page properties)."""
    result: dict[str, str] = {}
    for start in range(0, len(articles), 50):
        batch = sorted(articles)[start : start + 50]
        url = curation()["pageprops_api"].format(titles=quote("|".join(batch)))
        cache_name = f"pageprops_{start // 50}.json"
        payload = json.loads(
            fetch_bytes(url, POLITICS_RAW / cache_name, refresh=refresh, timeout=60)
        )
        query = payload.get("query", {})
        aliases = {n["to"]: n["from"] for n in query.get("normalized", [])}
        aliases.update(
            {r["to"]: aliases.get(r["from"], r["from"]) for r in query.get("redirects", [])}
        )
        for page in query.get("pages", []):
            item = page.get("pageprops", {}).get("wikibase_item")
            if item:
                result[aliases.get(page["title"], page["title"])] = item
    return result


def wikidata_leaders(*, refresh: bool) -> dict[str, set[str]]:
    """Wikidata's current (no end date, not deprecated) heads of state and government."""
    values = " ".join(f'"{c.iso3}"' for c in countries())
    query = f"""
SELECT ?iso ?person WHERE {{
  VALUES ?iso {{ {values} }}
  ?c wdt:P298 ?iso .
  VALUES ?prop {{ p:P35 p:P6 }}
  ?c ?prop ?st .
  ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS {{ ?st pq:P582 ?end }}
  {{ ?st ps:P35 ?person }} UNION {{ ?st ps:P6 ?person }}
}}"""
    result: dict[str, set[str]] = {}
    for row in sparql(query, refresh=refresh):
        result.setdefault(row["iso"], set()).add(row["person"].rsplit("/", 1)[-1])
    return result


# ── Deriving the records ─────────────────────────────────────────────────────


def _role(office: Office) -> str:
    if office.both:
        return "head_of_state_and_government"
    return "head_of_state" if office.column == 0 else "head_of_government"


def _transitional(office: Office, offices: list[Office]) -> bool:
    if office.provisional or re.search(r"\b(interim|transitional|acting)\b", office.title, re.I):
        return True
    # A junta's de facto leader shown above the same person's state office.
    return any(
        o.de_facto and o.row == 0 and o.person == office.person and o is not office for o in offices
    )


def derive_leaders(
    iso3: str, offices: list[Office]
) -> list[tuple[int, str, str, str, str | None, bool, bool, bool]]:
    """(position, role, title, person, article, executive, transitional, de facto) for the
    executive and, where different, the other of head of state and head of government."""
    override = curation()["executive_overrides"].get(iso3)
    people = [o for o in offices if o.person]
    if override:
        executive = Office(
            0,
            0 if override["role"] != "head_of_government" else 1,
            override["role"] == "head_of_state_and_government",
            True,
            False,
            True,
            override["title"],
            override["person"],
            override["article"],
        )
        partner = next((o for o in people if o.row == 0 and o.column == 1 and not o.both), None)
    else:
        executive_offices = [o for o in people if o.executive]
        if not executive_offices:
            raise PoliticsError(f"{iso3}: the list marks no executive office with a person")
        executive = executive_offices[0]
        partner = None
        if not executive.both:
            other = 1 - executive.column
            partner = next(
                (o for o in people if o.row == executive.row and o.column == other), None
            )
    # A person named only in a sub-row (no link there) keeps the article linked above.
    article = executive.article or next(
        (o.article for o in people if o.person == executive.person and o.article), None
    )
    rows = [
        (
            1,
            _role(executive),
            executive.title,
            str(executive.person),
            article,
            True,
            _transitional(executive, offices),
            executive.de_facto,
        )
    ]
    if partner is not None and partner.person != executive.person:
        rows.append(
            (
                2,
                _role(partner),
                partner.title,
                str(partner.person),
                partner.article,
                False,
                _transitional(partner, offices),
                partner.de_facto,
            )
        )
    return rows


def _kind(cell: ElectionCell, column: str) -> str:
    title = (cell.article or "").lower()
    if "general election" in title:
        return "general"
    if "presidential" in title:
        return "presidential"
    if "parliamentary" in title or "legislative" in title:
        return "legislative"
    return column


def derive_election(iso3: str, row: ElectionRow, executive_role: str) -> Election:
    decides = curation()["elections"].get(iso3, {}).get("decides")
    if decides is None:
        if executive_role == "head_of_government" or not row.presidential_next.applicable:
            decides = "legislative"
        else:
            decides = "presidential"
    if decides == "none":
        return Election(iso3, "none", None, None, None, None, None, None, None)
    next_cell = row.presidential_next if decides == "presidential" else row.legislative_next
    last_cell = row.presidential_last if decides == "presidential" else row.legislative_last
    if not next_cell.applicable:
        raise PoliticsError(f"{iso3}: no {decides} election in the list")
    return Election(
        iso3=iso3,
        decides=decides,
        kind=_kind(next_cell, decides),
        next_date=next_cell.date.date().isoformat() if next_cell.date else None,
        next_precision=next_cell.date.precision if next_cell.date else None,
        next_article=next_cell.article,
        last_date=last_cell.date.date().isoformat() if last_cell.date else None,
        last_precision=last_cell.date.precision if last_cell.date else None,
        last_article=last_cell.article,
    )


def election_status(election: Election, today: dt.date) -> str:
    """As the site computes it (election_status() in SQL): within 12 months, beyond, or no date
    (none set, or the listed date has passed and the list has not caught up)."""
    if election.next_date is None:
        return "no_date_set"
    date = dt.date.fromisoformat(election.next_date)
    if date < today:
        return "no_date_set"
    limit = _add_months(today, int(curation()["election_window_months"]))
    return "within_12_months" if date <= limit else "beyond_12_months"


def _add_months(day: dt.date, months: int) -> dt.date:
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    last = (dt.date(year + month // 12, month % 12 + 1, 1) - dt.timedelta(days=1)).day
    return dt.date(year, month, min(day.day, last))


# ── Quotes ───────────────────────────────────────────────────────────────────


def readable(wikitext: str) -> str:
    """Wikitext as plain words for quote checks: links to their text, template syntax dropped,
    footnote text kept."""
    text = COMMENT_RE.sub("", wikitext)
    text = re.sub(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", " ", text, flags=re.DOTALL)
    text = LINK_RE.sub(lambda m: m.group(2) or m.group(1), text)
    text = re.sub(
        r"\{\{\s*(?:efn|small|smalldiv|success|operational)\s*(?:\|\s*(?:align|name|1)\s*=[^|{}]*)*\|",
        " ",
        text,
    )
    text = text.replace("{{", " ").replace("}}", " ").replace("''", "")
    return re.sub(r"\s+", " ", text)


def check_quotes(pages: dict[str, str]) -> list[str]:
    readable_pages = {k: readable(v) for k, v in pages.items()}
    problems = []
    for iso3, note in curation()["notes"].items():
        for quote_text in note["quotes"]:
            if re.sub(r"\s+", " ", quote_text) not in readable_pages[note["source"]]:
                problems.append(f"{iso3} note: the source no longer says {quote_text!r}")
    for iso3, override in curation()["executive_overrides"].items():
        for quote_text in override["quotes"]:
            if quote_text not in readable_pages["leaders"]:
                problems.append(f"{iso3} executive: the source no longer says {quote_text!r}")
    return problems


# ── Build ────────────────────────────────────────────────────────────────────


def snapshot(leaders: list[Leader], elections: list[Election]) -> dict[str, Any]:
    return {
        "leaders": [asdict(x) for x in leaders],
        "elections": [asdict(x) for x in elections],
    }


def load_approved() -> dict[str, Any] | None:
    if not APPROVED_FILE.exists():
        return None
    data: dict[str, Any] = json.loads(APPROVED_FILE.read_text(encoding="utf-8"))
    return data


def differences(current: dict[str, Any], approved: dict[str, Any] | None) -> list[str]:
    if approved is None:
        return ["No snapshot has been approved yet: every record is new."]
    names = {c.iso3: c.name for c in countries()}
    out = []
    for kind, key in (("leaders", ("iso3", "position")), ("elections", ("iso3",))):
        now = {tuple(r[k] for k in key): r for r in current[kind]}
        before = {tuple(r[k] for k in key): r for r in approved[kind]}
        for ident in sorted(set(now) | set(before)):
            a, b = before.get(ident), now.get(ident)
            if a == b:
                continue
            label = f"{names[ident[0]]} ({kind[:-1]}{'' if len(ident) == 1 else f' {ident[1]}'})"
            if a is None:
                out.append(f"{label}: new: {_describe(kind, b)}")
            elif b is None:
                out.append(f"{label}: removed (was {_describe(kind, a)})")
            else:
                out.append(f"{label}: {_describe(kind, a)} → {_describe(kind, b)}")
    return out


def _describe(kind: str, record: dict[str, Any] | None) -> str:
    if record is None:
        return "—"
    if kind == "leaders":
        return f"{record['title']} – {record['person']}"
    if record["decides"] == "none":
        return "no national elections"
    return (
        f"{record['kind']} {record['next_date'] or 'no date'} ({record['next_precision'] or '—'})"
    )


def build(*, refresh: bool, today: dt.date | None = None) -> Result:
    today = today or dt.date.today()
    leaders_text, leaders_rev = fetch_page("leaders", refresh=refresh)
    elections_text, elections_rev = fetch_page("elections", refresh=refresh)
    problems = check_quotes({"leaders": leaders_text, "elections": elections_text})

    leader_names = {list_name(c.iso3, "leaders"): c.iso3 for c in countries()}
    election_names = {list_name(c.iso3, "elections"): c.iso3 for c in countries()}
    offices = parse_leaders(leaders_text, set(leader_names))
    rows = parse_elections(elections_text, set(election_names))
    for name, iso3 in leader_names.items():
        if name not in offices:
            problems.append(f"{iso3}: {name!r} not found in the leaders list")
    for name, iso3 in election_names.items():
        if name not in rows:
            problems.append(f"{iso3}: {name!r} not found in the elections list")
    if problems:
        raise PoliticsValidationError(problems)

    derived: list[tuple[str, tuple[int, str, str, str, str | None, bool, bool, bool]]] = []
    elections: list[Election] = []
    for country in countries():
        records = derive_leaders(country.iso3, offices[list_name(country.iso3, "leaders")])
        derived += [(country.iso3, r) for r in records]
        elections.append(
            derive_election(country.iso3, rows[list_name(country.iso3, "elections")], records[0][1])
        )

    articles = sorted({r[4] for _, r in derived if r[4]})
    qids = wikidata_ids(articles, refresh=refresh)
    leaders = [
        Leader(
            iso3,
            pos,
            role,
            title,
            person,
            article,
            qids.get(article) if article else None,
            executive,
            transitional,
            de_facto,
        )
        for iso3, (pos, role, title, person, article, executive, transitional, de_facto) in derived
    ]
    result = Result(
        leaders=leaders,
        elections=elections,
        notes={iso3: n["text"] for iso3, n in curation()["notes"].items()},
        revisions={
            curation()["sources"]["leaders"]["source_key"]: leaders_rev,
            curation()["sources"]["elections"]["source_key"]: elections_rev,
        },
        approved=load_approved(),
        today=today,
    )
    result.changes = differences(snapshot(leaders, elections), result.approved)

    wikidata = wikidata_leaders(refresh=refresh)
    names = {c.iso3: c.name for c in countries()}
    for leader in leaders:
        if leader.wikidata_qid is None:
            result.warnings.append(
                f"{names[leader.iso3]}: {leader.person} has no linked Wikidata item"
            )
        elif leader.wikidata_qid not in wikidata.get(leader.iso3, set()):
            result.wikidata_differences.append(
                f"{names[leader.iso3]}: Wikidata does not list {leader.person} "
                f"({leader.wikidata_qid}) as a current head of state or government"
            )
    for election in elections:
        if election.next_date and dt.date.fromisoformat(election.next_date) < today:
            result.warnings.append(
                f"{names[election.iso3]}: the listed next election ({election.next_date}) has "
                "passed; the list has not been updated yet, so the site shows no date"
            )
    validate(result)
    return result


def validate(result: Result) -> None:
    problems = []
    iso3s = {c.iso3 for c in countries()}
    if {x.iso3 for x in result.leaders} != iso3s:
        problems.append("Not every country has a leader")
    if {e.iso3 for e in result.elections} != iso3s:
        problems.append("Not every country has an election record")
    for iso3 in iso3s:
        executives = [x for x in result.leaders if x.iso3 == iso3 and x.executive]
        if len(executives) != 1:
            problems.append(f"{iso3}: {len(executives)} executive leaders (expected one)")
    for election in result.elections:
        if election.decides != "none" and election.kind is None:
            problems.append(f"{election.iso3}: election without a kind")
    if problems:
        raise PoliticsValidationError(problems)


# ── Seed and approval ────────────────────────────────────────────────────────


def approve(result: Result) -> None:
    body = {
        "$comment": (
            "The leaders and elections the site shows, as approved by the project owner. Written "
            "by `python -m pipelines politics --approve` after the review report has been read."
        ),
        "approved_on": result.today.isoformat(),
        "revisions": result.revisions,
        **snapshot(result.leaders, result.elections),
    }
    APPROVED_FILE.write_text(
        json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    result.approved = body
    result.changes = []


def payload(result: Result) -> dict[str, Any]:
    approved = result.approved
    # Until a snapshot is approved, the seed carries the proposed records and `load` skips them.
    shown = approved or snapshot(result.leaders, result.elections)
    leaders_source = curation()["sources"]["leaders"]["source_key"]
    elections_source = curation()["sources"]["elections"]["source_key"]
    as_of = approved["approved_on"] if approved else result.today.isoformat()
    return {
        # No run date: the weekly refresh changes this seed only when the records or the
        # pending changes do.
        "$generated": {
            "by": "python -m pipelines politics",
            "approved_on": approved["approved_on"] if approved else None,
            "pending_changes": result.changes,
        },
        "datasets": [
            {
                "key": "vinara-leaders",
                "name": "Heads of state and government",
                "provider": (
                    "Wikipedia (List of current heads of state and government), with Wikidata"
                ),
                "license": "Facts; Wikipedia text CC BY-SA 4.0, Wikidata CC0",
                "attribution": (
                    "Leaders: Wikipedia, List of current heads of state and government; Wikidata."
                ),
                "coverage_start": None,
                "coverage_end": None,
                "as_of": as_of,
                "refresh_cadence": "weekly",
            },
            {
                "key": "vinara-elections",
                "name": "Next national elections",
                "provider": "Wikipedia (List of next general elections)",
                "license": "Facts; Wikipedia text CC BY-SA 4.0",
                "attribution": "Elections: Wikipedia, List of next general elections.",
                "coverage_start": None,
                "coverage_end": None,
                "as_of": as_of,
                "refresh_cadence": "weekly",
            },
        ],
        "sources": [
            source_record("leaders").seed(),
            source_record("elections").seed(),
            WIKIDATA.seed(),
        ],
        "approved_on": approved["approved_on"] if approved else None,
        "leaders": table(
            [
                "iso3",
                "position",
                "role",
                "title",
                "person",
                "article",
                "wikidata_qid",
                "executive",
                "transitional",
                "de_facto",
                "source",
            ],
            [
                [
                    r["iso3"],
                    r["position"],
                    r["role"],
                    r["title"],
                    r["person"],
                    r["article"],
                    r["wikidata_qid"],
                    r["executive"],
                    r["transitional"],
                    r["de_facto"],
                    leaders_source,
                ]
                for r in shown["leaders"]
            ],
        ),
        "elections": table(
            [
                "iso3",
                "decides",
                "kind",
                "next_date",
                "next_precision",
                "next_article",
                "last_date",
                "last_precision",
                "last_article",
                "source",
            ],
            [
                [
                    r["iso3"],
                    r["decides"],
                    r["kind"],
                    r["next_date"],
                    r["next_precision"],
                    r["next_article"],
                    r["last_date"],
                    r["last_precision"],
                    r["last_article"],
                    elections_source,
                ]
                for r in shown["elections"]
            ],
        ),
        "notes": dict(sorted(result.notes.items())),
    }


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of the cache")
    parser.add_argument(
        "--approve",
        action="store_true",
        help="record what the lists say now as the approved snapshot (after reading the report)",
    )


def run(args: argparse.Namespace) -> int:
    from . import politics_report

    try:
        result = build(refresh=bool(args.refresh))
    except PoliticsValidationError as error:
        print(f"Validation failed ({len(error.problems)} problems):\n{error}")
        return 1
    if args.approve:
        approve(result)
        print(f"Approved the current leaders and elections ({APPROVED_FILE.name}).")
    write_seed(POLITICS_SEED, payload(result))
    REPORT_PATH.write_text(politics_report.render(result), encoding="utf-8")
    state = f"approved {result.approved['approved_on']}" if result.approved else "awaiting approval"
    print(
        f"Politics: {len(result.leaders)} office holders and {len(result.elections)} elections; "
        f"{state}; {len(result.changes)} pending change(s); "
        f"{len(result.wikidata_differences)} Wikidata difference(s). Wrote {REPORT_PATH.name}."
    )
    for change in result.changes[:10]:
        print(f"  {change}")
    return 0
