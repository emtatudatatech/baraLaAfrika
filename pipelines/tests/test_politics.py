from __future__ import annotations

import dataclasses
import datetime as dt
import json

from pipelines.africa_pipelines import politics
from pipelines.africa_pipelines.politics import Election
from pipelines.africa_pipelines.politics_wikitext import (
    ElectionDate,
    parse_dts,
    parse_elections,
    parse_leaders,
)

LEADERS = """
{|class="wikitable"
!scope="row" |{{flag|Kenya}}
|colspan=2 {{success |[[President of Kenya|President]] – [[William Ruto]]}}
|-
!scope="row" |{{flag|Ethiopia}}
|[[President of Ethiopia|President]] – [[Taye Atske Selassie]]
|{{success |align=left |[[Prime Minister of Ethiopia|Prime Minister]] – [[Abiy Ahmed]]}}
|-
!scope="row" rowspan=2 |{{flag|Niger}}
|colspan=2 {{operational |{{small|President of the [[CNSP]] – [[Abdourahamane Tiani]]}}}}
|-
|{{success |align=left |{{small|Transitional [[List of heads of state of Niger|President]] – Abdourahamane Tiani}}<ref>{{cite web |title=x}}</ref>}}
|[[List of prime ministers of Niger|Prime Minister]] – [[Ali Lamine Zeine]]{{efn |name=X |A note [[with]] a link.}}
|-
!scope="row" |{{flag|Somalia}}
|{{operational |align=left |[[President of Somalia|President]] – [[Hassan Sheikh Mohamud]]}}
|{{success |align=left |[[List of prime ministers of Somalia|Prime Minister]] – [[Hamza Abdi Barre]]}}
|-
!scope="row" |{{flag|Malta}}
|[[President of Malta|President]] – [[Someone]]
|{{success |align=left |Prime Minister – [[Robert Abela]]}}
|}
"""

ELECTIONS = """
===Africa===
{| class="wikitable sortable"
|-
! rowspan=2|Country
|-
! Term
|-
|{{Flag|Kenya}}
|5
|[[2022 Kenyan general election|{{dts|9 Aug 2022}}]]
|[[2027 Kenyan general election|{{dts|10 Aug 2027}}]]
|5
|[[2022 Kenyan general election|{{dts|9 Aug 2022}}]]
|[[2027 Kenyan general election|{{dts|10 Aug 2027}}]]
|Protests
|[[UDA]]
|-
|{{Flag|Ethiopia}}
|5
|[[2026 Ethiopian general election|{{dts|1 Jun 2026}}]]
|{{dts|Jun 2031}}
|6
|[[2024 Ethiopian presidential election|{{dts|7 Oct 2024}}]]
|{{dts|Oct 2030}}
|
|PP
|-
|{{Flag|Botswana}}
|5
|[[2024 Botswana general election|{{dts|30 Oct 2024}}]]
|[[Next Botswana general election|{{dts|7 Jan 2030}}]]
|colspan=3 {{n/a}}
|
|UDC
|-
|{{Flag|Mali}}
|5
|[[2020 Malian parliamentary election|{{dts|29 Mar 2020}}]]
|[[Next Malian parliamentary election|Next]]
|5
|[[2018 Malian presidential election|{{dts|29 Jul 2018}}]]
|[[Next Malian presidential election|Next]]
|Coup
|Junta
|}
"""


def test_leaders_list_marks_the_executive_and_the_transitional_office() -> None:
    offices = parse_leaders(LEADERS, {"Kenya", "Ethiopia", "Niger", "Somalia"})
    assert set(offices) == {"Kenya", "Ethiopia", "Niger", "Somalia"}  # Malta is not asked for
    kenya = offices["Kenya"]
    assert [(o.both, o.executive, o.title, o.person) for o in kenya] == [
        (True, True, "President", "William Ruto")
    ]
    niger = politics.derive_leaders("NER", offices["Niger"])
    assert [(r[0], r[1], r[2], r[3], r[4], r[6]) for r in niger] == [
        (1, "head_of_state", "Transitional President", "Abdourahamane Tiani", "Abdourahamane Tiani", True),
        (2, "head_of_government", "Prime Minister", "Ali Lamine Zeine", "Ali Lamine Zeine", False),
    ]  # fmt: skip
    ethiopia = politics.derive_leaders("ETH", offices["Ethiopia"])
    assert [(r[1], r[3]) for r in ethiopia] == [
        ("head_of_government", "Abiy Ahmed"),
        ("head_of_state", "Taye Atske Selassie"),
    ]
    somalia = politics.derive_leaders("SOM", offices["Somalia"])
    assert [(r[3], r[5], r[7]) for r in somalia] == [
        ("Hamza Abdi Barre", True, False),
        ("Hassan Sheikh Mohamud", False, True),  # de facto
    ]


def test_dates_keep_their_precision_and_stand_for_the_latest_day() -> None:
    assert parse_dts("{{dts|10 Aug 2027}}") == ElectionDate(2027, 8, 10)
    assert parse_dts("{{dts|5 June 2025}}") == ElectionDate(2025, 6, 5)
    month = parse_dts("{{dts|Feb 2028}}")
    assert month is not None and month.precision == "month"
    assert month.date() == dt.date(2028, 2, 29)
    year = parse_dts("{{dts|2026}}")
    assert year is not None and year.date() == dt.date(2026, 12, 31)
    assert parse_dts("[[Next Malian presidential election|Next]]") is None


def test_the_election_that_decides_the_executive() -> None:
    rows = parse_elections(ELECTIONS, {"Kenya", "Ethiopia", "Botswana", "Mali"})
    kenya = politics.derive_election("KEN", rows["Kenya"], "head_of_state_and_government")
    assert (kenya.decides, kenya.kind, kenya.next_date, kenya.next_precision) == (
        "presidential",
        "general",
        "2027-08-10",
        "day",
    )
    assert kenya.last_date == "2022-08-09"
    # A prime minister holds executive power: the legislative election decides it.
    ethiopia = politics.derive_election("ETH", rows["Ethiopia"], "head_of_government")
    assert (ethiopia.decides, ethiopia.next_date, ethiopia.next_precision) == (
        "legislative",
        "2031-06-30",
        "month",
    )
    # No presidential election (parliament elects the president).
    botswana = politics.derive_election("BWA", rows["Botswana"], "head_of_state_and_government")
    assert (botswana.decides, botswana.kind) == ("legislative", "general")
    mali = politics.derive_election("MLI", rows["Mali"], "head_of_state_and_government")
    assert (mali.next_date, mali.next_article) == (None, "Next Malian presidential election")


def test_election_status_counts_twelve_months_from_today() -> None:
    today = dt.date(2026, 10, 22)

    def status(date: str | None) -> str:
        election = Election("KEN", "presidential", "general", date, "day" if date else None, None, None, None, None)  # fmt: skip
        return politics.election_status(election, today)

    assert status("2027-10-22") == "within_12_months"
    assert status("2027-10-23") == "beyond_12_months"
    assert status(None) == "no_date_set"
    assert status("2026-10-01") == "no_date_set"  # passed: the list has not caught up


def test_notes_and_overrides_must_still_be_in_their_sources() -> None:
    problems = politics.check_quotes({"leaders": "", "elections": ""})
    curation = politics.curation()
    expected = sum(len(n["quotes"]) for n in curation["notes"].values()) + sum(
        len(o["quotes"]) for o in curation["executive_overrides"].values()
    )
    assert len(problems) == expected


def test_readable_text_keeps_footnotes_and_link_text() -> None:
    text = politics.readable(
        "{{efn |The presidency has been [[Constitutional crisis|disputed]] since 15 May 2026.}}"
    )
    assert "The presidency has been disputed since 15 May 2026." in text


def test_differences_from_the_approved_snapshot_are_listed() -> None:
    leader = politics.Leader("KEN", 1, "head_of_state_and_government", "President", "William Ruto", "William Ruto", "Q195725", True, False, False)  # fmt: skip
    election = Election("KEN", "presidential", "general", "2027-08-10", "day", None, None, None, None)  # fmt: skip
    approved = politics.snapshot([leader], [election])
    assert politics.differences(approved, approved) == []
    changed = politics.snapshot(
        [dataclasses.replace(leader, person="Someone Else")],
        [dataclasses.replace(election, next_date="2027-08-17")],
    )
    changes = politics.differences(changed, approved)
    assert len(changes) == 2
    assert "President – William Ruto → President – Someone Else" in changes[0]
    assert politics.differences(changed, None) == [
        "No snapshot has been approved yet: every record is new."
    ]


def test_committed_seed_has_one_executive_and_one_election_per_country() -> None:
    seed = json.loads(politics.POLITICS_SEED.read_text(encoding="utf-8"))
    leaders = [
        dict(zip(seed["leaders"]["columns"], r, strict=True)) for r in seed["leaders"]["rows"]
    ]
    elections = [
        dict(zip(seed["elections"]["columns"], r, strict=True)) for r in seed["elections"]["rows"]
    ]
    executives = [r["iso3"] for r in leaders if r["executive"]]
    assert len(executives) == len(set(executives)) == 54
    assert len({r["iso3"] for r in elections}) == len(elections) == 54
    assert all(r["position"] == (1 if r["executive"] else 2) for r in leaders)
    assert {r["decides"] for r in elections} <= {"presidential", "legislative", "none"}
