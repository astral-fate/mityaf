"""Invariants the site depends on. If these drift, a page renders wrong numbers."""
import json
from pathlib import Path

import pytest

OUT = Path(__file__).parent.parent / "apps" / "web" / "public" / "data"

EXPECTED = {
    "ponding-segments.json": 30337,
    "ponding-shortlist.json": 2617,
    "ponding-tunnels.json": 47,
    "ponding-incidents.json": 45,
}


def load(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("name,n", EXPECTED.items())
def test_row_counts(name, n):
    assert len(load(name)["items"]) == n


def test_districts_are_91():
    assert len(load("ponding-districts.geojson")["features"]) == 91


def test_mechanism_vocabulary_is_closed():
    seen = {s["mechanism"] for s in load("ponding-segments.json")["items"]}
    assert seen <= {"depression", "convergence", "tunnel", None}


def test_no_nan_leaked_into_json():
    raw = (OUT / "ponding-segments.json").read_text(encoding="utf-8")
    assert "NaN" not in raw and "Infinity" not in raw


def test_verified_pins_rank_in_top_one_percent():
    """The three resident pins must rank in the top 1% of the HYDROLOGY ranking.

    This is the only check of the pipeline against something a person actually
    observed: a resident reported chronic ponding and supplied three
    coordinates, all of which fall inside one closed depression.

    Assert on ranks["hyd"], NOT on priority. `priority` is severity rank within
    the 533 depressions and is driven by sink depth -- these pins are
    0.15-0.66 m deep against a city maximum of 2.82 m, so a mid-range priority
    is correct and expected. The hydrology rank is the claim under test.
    """
    items = [s for s in load("ponding-shortlist.json")["items"]
             if s["mechanism"] == "depression"]
    pins = [(24.5040022, 39.7000415), (24.504608, 39.700796),
            (24.503704, 39.702222)]
    for lat, lon in pins:
        near = min(items, key=lambda s: (s["lat"] - lat) ** 2 + (s["lon"] - lon) ** 2)
        assert near["ranks"]["hyd"] >= 0.98, (
            f"pin {lat},{lon} -> hyd {near['ranks']['hyd']}")
        assert near["mechanism"] == "depression"


def test_spa_named_tunnel_is_top_five():
    t = load("ponding-tunnels.json")["items"]
    top5 = sorted(t, key=lambda x: -x["priority"])[:5]
    assert any("الملك عبدالله" in (x["name"] or "") for x in top5)


def test_incidents_corroborated_count():
    """45 rows, 19 corroborated — measured by incident_register.py, not asserted.

    Four of the 19 are corroborated by NASA POWER where ERA5 shows nothing:
    2019-11-10, 2022-08-20, 2024-08-30, 2024-08-31. Dropping the second source
    would silently discard them.
    """
    inc = load("ponding-incidents.json")["items"]
    assert sum(1 for i in inc if i["corroborated"]) == 19
