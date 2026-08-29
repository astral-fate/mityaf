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

# Every file that carries a top-level `count`. MapView.jsx:215 was changed to
# render `count` rather than `items.length` precisely so no number is computed
# in the browser -- which turns "the two agree" from an observation into a
# contract, and a contract with no test is a coincidence waiting to end.
COUNTED = [*EXPECTED, "ponding-rain.json"]

# The shape the JS reads. Renaming any of these in export_web.py used to pass
# 10/10 and silently blank a page; each entry here is a key some component
# dereferences by name.
SEGMENT_FIELDS = {"id", "lat", "lon", "district", "name", "mechanism",
                  "priority", "ranks", "terrain", "pct", "ood"}
RANK_KEYS = {"hyd", "model", "road", "consensus"}
TERRAIN_KEYS = {"sink", "slope", "hand", "twi", "logacc"}
TUNNEL_FIELDS = {"osmId", "name", "highway", "lat", "lon", "lengthM",
                 "district", "logacc", "priority"}
INCIDENT_FIELDS = {"date", "district", "place", "source", "stream", "lat",
                   "lon", "mechanism", "era5_peak_mm", "power_peak_mm",
                   "best_mm", "corroborated", "which_source"}
DISTRICT_FIELDS = {"name", "shortlistCount", "depressionCount",
                   "convergenceCount", "tunnelCount", "topPriority",
                   "medianHydRank", "incidentCount", "corroboratedCount",
                   "verified"}

MECHANISMS = {"depression", "convergence", "tunnel"}


def load(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("name,n", EXPECTED.items())
def test_row_counts(name, n):
    assert len(load(name)["items"]) == n


@pytest.mark.parametrize("name", COUNTED)
def test_count_matches_len_items(name):
    """`count` is what the UI renders; `len(items)` is what it draws."""
    d = load(name)
    assert d["count"] == len(d["items"]), name


def test_districts_are_91():
    assert len(load("ponding-districts.geojson")["features"]) == 91


# ── contract shape ───────────────────────────────────────────────────


def test_segment_fields_are_present():
    for name in ("ponding-segments.json", "ponding-shortlist.json"):
        s = load(name)["items"][0]
        assert set(s) == SEGMENT_FIELDS, name
        assert set(s["ranks"]) == RANK_KEYS, name
        assert set(s["terrain"]) == TERRAIN_KEYS, name
        assert set(s["pct"]) == TERRAIN_KEYS, name


def test_tunnel_fields_are_present():
    assert set(load("ponding-tunnels.json")["items"][0]) == TUNNEL_FIELDS


def test_incident_fields_are_present():
    assert set(load("ponding-incidents.json")["items"][0]) == INCIDENT_FIELDS


def test_district_fields_are_present():
    for f in load("ponding-districts.geojson")["features"]:
        assert DISTRICT_FIELDS <= set(f["properties"])


def test_scalars_the_pages_read_are_exported():
    """No number is computed in the browser, so the export must supply them."""
    inc = load("ponding-incidents.json")
    assert inc["corroboratedCount"] + inc["unconfirmedCount"] == inc["count"]

    short = load("ponding-shortlist.json")
    assert set(short["byMechanism"]) == {"depression", "convergence"}

    totals = load("ponding-districts.geojson")["totals"]
    assert set(totals) >= {"districtCount", "shortlistCount", "depressionCount",
                           "convergenceCount", "tunnelCount", "verifiedCount",
                           "incidentCount", "corroboratedCount"}


# ── the branch's own constraint counts ───────────────────────────────


def test_district_sums_reproduce_the_constraint_counts():
    """91 districts must partition the shortlist exactly.

    2,617 / 533 / 2,084 / 47 are quoted on the districts header, in the deck
    and in the spec. A segment falling outside every Voronoi cell would drop
    one of these without failing anything else.
    """
    props = [f["properties"] for f in load("ponding-districts.geojson")["features"]]
    got = {k: sum(p[k] for p in props) for k in
           ("shortlistCount", "depressionCount", "convergenceCount", "tunnelCount")}
    assert got == {"shortlistCount": 2617, "depressionCount": 533,
                   "convergenceCount": 2084, "tunnelCount": 47}


def test_district_totals_match_the_rows_they_summarise():
    d = load("ponding-districts.geojson")
    props = [f["properties"] for f in d["features"]]
    t = d["totals"]
    assert t["districtCount"] == len(props)
    for k in ("shortlistCount", "depressionCount", "convergenceCount",
              "tunnelCount", "incidentCount", "corroboratedCount"):
        assert t[k] == sum(p[k] for p in props), k
    assert t["verifiedCount"] == sum(1 for p in props if p["verified"])


def test_shortlist_byMechanism_matches_the_rows():
    s = load("ponding-shortlist.json")
    for m, n in s["byMechanism"].items():
        assert sum(1 for i in s["items"] if i["mechanism"] == m) == n, m
    assert sum(s["byMechanism"].values()) == s["count"]


def test_mechanism_vocabulary_is_closed():
    """Three keys, and `null` for unflagged. In EVERY file, not just one.

    ponding-incidents.json used to spell "no mechanism" as the string
    "unknown" on 25 of 45 rows while ponding-segments.json spelt it null, and
    a test scoped to one file could not see the disagreement.
    """
    for name in ("ponding-segments.json", "ponding-shortlist.json",
                 "ponding-incidents.json"):
        seen = {s["mechanism"] for s in load(name)["items"]}
        assert seen <= MECHANISMS | {None}, (name, seen)


def test_shortlist_is_a_subset_of_segments_and_fully_classified():
    seg_ids = {s["id"] for s in load("ponding-segments.json")["items"]}
    for s in load("ponding-shortlist.json")["items"]:
        assert s["id"] in seg_ids, s["id"]
        assert s["mechanism"] in MECHANISMS, s["id"]
        assert s["priority"] is not None, s["id"]


def test_no_nan_leaked_into_json():
    raw = (OUT / "ponding-segments.json").read_text(encoding="utf-8")
    assert "NaN" not in raw and "Infinity" not in raw


# ── basin: the platform's one measured claim ─────────────────────────


def test_basin_carries_the_headline_claim():
    """`basin.core` and the core->pin distance are the site's only measured claim.

    The evidence page used to hardcode the pin coordinate and "38 m" as
    literals beside a core read from this file, so a rerun that moved the core
    would have printed a distance contradicting the two coordinates either
    side of it. Both halves now come from here.
    """
    b = load("ponding-basin.json")
    assert 24.4 < b["core"]["lat"] < 24.6
    assert 39.6 < b["core"]["lon"] < 39.8
    assert b["segmentCount"] == 57
    assert len(b["items"]) == b["segmentCount"]
    assert b["maxSinkM"] > 0
    assert len(b["bbox"]) == 4

    i = b["prediction"]["pinIndex"]
    pin = b["pins"][i]
    assert set(pin) >= {"lat", "lon"}
    # ~38 m: the claim quoted on /dashboard/evidence and in the deck.
    assert 30 <= b["prediction"]["distanceM"] <= 45, b["prediction"]


def test_rain_file_carries_dated_rows():
    r = load("ponding-rain.json")
    assert r["count"] == 29
    assert r["note"]
    for row in r["items"]:
        assert set(row) == {"date", "peakMm"}
        assert row["peakMm"] >= 5.0, row


# ── claims checked against observation ───────────────────────────────


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
    inc = load("ponding-incidents.json")
    assert sum(1 for i in inc["items"] if i["corroborated"]) == 19
    assert inc["corroboratedCount"] == 19


def test_no_english_prose_reaches_the_arabic_table():
    """`place` and `which_source` render verbatim in an Arabic table.

    ERA5 and NASA POWER are proper nouns and stay Latin; "both", "neither" and
    18 English `place` values did not, and shipped into the one page whose
    whole purpose is credibility.
    """
    allowed = {"ERA5", "NASA POWER"}
    for i in load("ponding-incidents.json")["items"]:
        assert i["which_source"] in allowed or not i["which_source"].isascii(), i
        place = str(i["place"])
        latin = [c for c in place if c.isascii() and c.isalpha()]
        assert not latin, (i["date"], place)
