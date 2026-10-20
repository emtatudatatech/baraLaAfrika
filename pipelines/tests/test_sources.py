from __future__ import annotations

import pytest

from pipelines.africa_pipelines import sources


def test_classifies_by_domain_including_subdomains() -> None:
    assert sources.classify("https://en.wikipedia.org/wiki/X").tier == "reference"
    assert sources.classify("https://countryhumans.miraheze.org/wiki/South_Africa").tier == "low"
    assert sources.classify("https://www.reddit.com/r/x").source_type == "forum"


def test_unknown_domains_fail_loudly() -> None:
    with pytest.raises(sources.UnclassifiedSourceError):
        sources.classify("https://example.org/page")


def test_does_not_match_lookalike_domains() -> None:
    with pytest.raises(sources.UnclassifiedSourceError):
        sources.classify("https://notwikipedia.org/x")


@pytest.mark.parametrize(
    ("tiers", "expected"),
    [
        ([], True),
        (["low"], True),
        (["low", "reference"], True),
        (["reference", "secondary"], False),
    ],
)
def test_mainly_low_tier(tiers: list[sources.Tier], expected: bool) -> None:
    assert sources.mainly_low_tier(tiers) is expected
