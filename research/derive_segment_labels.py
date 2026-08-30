# -*- coding: utf-8 -*-
"""Give the unnamed street segments a label a dispatcher can act on.

Only 791 of Madinah's 18,320 OSM ways carry a name tag, so about nine in ten
ranked segments render as «شارع بلا اسم». That is accurate but useless: a crew
sent to «شارع بلا اسم — العهن» has been told nothing.

Street names cannot be invented -- a municipal crew would be dispatched on them.
What CAN be derived is position relative to a road that IS named, straight from
the OSM geometry:

    امتداد طريق الملك عبد العزيز        (within 25 m -- almost surely the same
                                        corridor, just an unnamed sub-way)
    قرب طريق الملك عبد العزيز — 120 م   (further off; a bearing, not a claim)

The 25 m cut is deliberately tight. Anything looser starts asserting that two
roads are the same street, which is exactly the kind of invented fact this is
meant to avoid. Beyond the cut the wording drops to «قرب», which claims only
proximity, and the distance is shown so the reader can judge it.

Writes segment-labels.json keyed by segment id, for the web app to join.

    .venv/Scripts/python.exe derive_segment_labels.py
"""
from __future__ import annotations

import json
import re
import math
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

HERE = Path(__file__).parent
CACHE = HERE / "cache" / "madinah"
WEB = HERE.parent / "apps" / "web" / "public" / "data"
GEO = WEB / "segments.geojson"          # what the dashboard actually loads
SEGS = WEB / "ponding-segments.json"    # the same export in another shape
OUT = WEB / "segment-labels.json"       # superseded; removed if present

SAME_CORRIDOR_M = 25.0        # at or under this, call it an extension
MAX_USEFUL_M = 600.0          # beyond this, naming a far-off road misleads
R = 6371000.0


def to_xyz(lon, lat):
    """Unit-sphere cartesian, so a KD-tree gives true nearest neighbours."""
    la, lo = np.radians(lat), np.radians(lon)
    c = np.cos(la)
    return np.stack([c * np.cos(lo), c * np.sin(lo), np.sin(la)], axis=-1)


SHARDS = 64
SHARD_DIR = WEB / "seg"


def shard_key(seg_id: str) -> int:
    """Bucket a segment id. Must match segmentShard() in apps/web/lib/data.js.

    A plain code-unit sum, because the only requirement is that both languages
    agree and the ids (seg_<digits>_<digits>) are ASCII. Anything cleverer would
    be one more thing to keep in sync across two runtimes.
    """
    return sum(ord(c) for c in seg_id) % SHARDS


def shard_segments(data: dict) -> None:
    """Split the collection so a detail page fetches ~140 KB, not 9 MB.

    The segment detail view needs one feature. It was loading segments.geojson
    (9.1 MB) to find it, plus segments-top.json, plus ponding-segments.json
    (13 MB) whenever the id was not on the 2,617-row shortlist -- which is the
    common case, since 27,720 of 30,337 segments are not. Measured cold, that
    page moved 11.95 MB to render one street.

    Sixty-four buckets keeps each one small enough to parse instantly while
    keeping the directory listable, which per-id files would not be at 30,337
    entries.
    """
    # The detail view also wants the ponding record -- mechanism, priority,
    # ranks, terrain -- which lives in ponding-segments.json. Merging it in here
    # is what turns that page into a single request; leaving it out would just
    # move the 13 MB fetch rather than remove it.
    # Copy the whole record and drop what is redundant, rather than listing the
    # fields to keep. The first version whitelisted seven keys and missed `pct`
    # and `ood`, so the page threw on seg.pct[k]. A whitelist silently omits
    # whatever it does not know about; a blacklist fails loudly by carrying
    # something extra.
    DROP = {"id", "name"}       # both already on feature.properties
    ponding = {}
    if SEGS.exists():
        for it in json.loads(SEGS.read_text(encoding="utf-8")).get("items", []):
            ponding[it["id"]] = {k: v for k, v in it.items() if k not in DROP}

    buckets: dict[int, list] = {i: [] for i in range(SHARDS)}
    for f in data["features"]:
        sid = f["properties"]["id"]
        rec = ponding.get(sid)
        if rec:
            f = {**f, "ponding": rec}
        buckets[shard_key(sid)].append(f)

    SHARD_DIR.mkdir(parents=True, exist_ok=True)
    for old in SHARD_DIR.glob("*.json"):
        old.unlink()

    sizes = []
    for i, feats in buckets.items():
        payload = {
            "shard": i,
            # the lookup carries the road names it references, so a detail page
            # never needs the parent collection for a label
            "roadNames": data.get("roadNames", []),
            "features": feats,
        }
        p = SHARD_DIR / f"{i:02d}.json"
        p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        sizes.append(p.stat().st_size)

    print(f"  sharded {len(data['features']):,} segments into {SHARDS} files "
          f"in {SHARD_DIR.name}/ "
          f"(median {sorted(sizes)[len(sizes)//2]/1024:.0f} KB, "
          f"max {max(sizes)/1024:.0f} KB)")

    # The list page renders a sortable table and no map, so every byte of
    # geometry it downloads is wasted -- 2.54 MB of the 9.06 MB collection.
    # This is the same rows without it.
    lst = WEB / "segments-list.json"
    lst.write_text(json.dumps({
        "count": len(data["features"]),
        "roadNames": data.get("roadNames", []),
        "items": [f["properties"] for f in data["features"]],
    }, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {lst.name}: {lst.stat().st_size/1048576:.2f} MB "
          f"(vs {GEO.stat().st_size/1048576:.2f} MB with geometry)")


def main() -> None:
    els = json.loads((CACHE / "roads.json").read_text(encoding="utf-8"))["elements"]

    # Many arterials are tagged in English on some ways and Arabic on others —
    # «Al Hijra Road» here, «طريق مكة - المدينة / طريق الهجرة» a block later. Ways
    # carrying BOTH tags give the mapping, so an English-only way can be shown
    # under the Arabic name OSM itself uses for that road. This is a lookup, not
    # a translation: a road with no Arabic anywhere in the extract keeps its
    # English name rather than having one invented for it.
    alias = {}
    for w in els:
        t = w.get("tags", {})
        en, ar = t.get("name:en"), t.get("name:ar")
        if en and ar:
            alias.setdefault(en.strip(), ar.strip())
    print(f"{len(alias)} English road names have an Arabic pairing in OSM")

    # every vertex of every NAMED way, carrying its name back
    pts, names = [], []
    for w in els:
        # name:ar first. Madinah's OSM stores many arterials under an English
        # `name` («Othman Ibn Affan Road»), and reading that into an Arabic
        # dashboard puts Latin street names in every other row.
        t = w.get("tags", {})
        raw = t.get("name") or ""
        nm = (t.get("name:ar")
              or alias.get(t.get("name:en", "").strip())
              or alias.get(raw.strip())      # `name` often holds the English one
              or raw)
        # A name tag of «3» is a lane number someone typed into the wrong field.
        # Anchoring a label to it produces «قرب 3 — 200 م», which is worse than
        # admitting there is no named road nearby.
        if not nm or len(nm.strip()) < 3 or not re.search(r"[^\W\d_]", nm):
            continue
        for p in w.get("geometry", []):
            pts.append((p["lon"], p["lat"]))
            names.append(nm)
    print(f"{len(set(names))} distinct named roads · {len(pts)} vertices")

    tree = cKDTree(to_xyz(np.array([p[0] for p in pts]),
                          np.array([p[1] for p in pts])))

    # segments.geojson is what the dashboard actually loads; ponding-segments
    # .json is the same export in another shape and is kept in step so the two
    # never disagree about what a segment is called.
    data = json.loads(GEO.read_text(encoding="utf-8"))
    items = [f["properties"] for f in data["features"]]

    def midpoint(feat):
        """A segment's own middle vertex -- its endpoints may sit on a junction
        with a named road, which would flatter the distance."""
        g = feat.get("geometry") or {}
        c = g.get("coordinates") or []
        while c and isinstance(c[0], list) and c and isinstance(c[0][0], list):
            c = c[0]                      # MultiLineString -> first part
        return tuple(c[len(c) // 2]) if c else None

    unnamed = [(f["properties"], midpoint(f)) for f in data["features"]
               if not f["properties"].get("name")]
    unnamed = [(p, m) for p, m in unnamed if m]
    print(f"{len(unnamed)} of {len(items)} segments have no name of their own")

    q = to_xyz(np.array([m[0] for _p, m in unnamed], dtype=float),
               np.array([m[1] for _p, m in unnamed], dtype=float))
    chord, idx = tree.query(q, k=1)
    # chord length on the unit sphere -> great-circle metres
    dist_m = 2.0 * R * np.arcsin(np.clip(np.asarray(chord) / 2.0, 0, 1))

    # The road name is written ONCE into a lookup and referenced by index. Spelt
    # out per segment it costs ~3 MB on top of a file that is already 12.6 MB;
    # interned it costs ~0.4 MB, and the page makes no extra request because the
    # labels ride in the file it already loads.
    road_ix, roads = {}, []
    far, buckets = 0, {"امتداد": 0, "قرب": 0}
    by_id = {}
    for (p, _m), i, d in zip(unnamed, idx, dist_m):
        if d > MAX_USEFUL_M:
            far += 1
            continue
        nm = names[int(i)]
        if nm not in road_ix:
            road_ix[nm] = len(roads)
            roads.append(nm)
        buckets["امتداد" if d <= SAME_CORRIDOR_M else "قرب"] += 1
        by_id[p["id"]] = [road_ix[nm], round(float(d))]

    print(f"\n  امتداد (≤ {SAME_CORRIDOR_M:.0f} m)  {buckets['امتداد']:6}")
    print(f"  قرب                    {buckets['قرب']:6}")
    print(f"  no named road within {MAX_USEFUL_M:.0f} m — left unlabelled  {far}")

    d_named = dist_m[dist_m <= MAX_USEFUL_M]
    if len(d_named):
        print(f"\n  distance to nearest named road: median "
              f"{np.median(d_named):.0f} m · p90 {np.percentile(d_named, 90):.0f} m")
        print("  NOTE: a 200 m median is a bearing, not an address. The label "
              "helps\n        orientation; the coordinate stays the locator.")

    NOTE = ("تسميات مشتقّة من أقرب طريق مُسمّى في OpenStreetMap "
            "— ليست أسماء رسمية.")
    for s in items:
        s.pop("nd", None)
        nd = by_id.get(s["id"])
        if nd:
            s["nd"] = nd
    before = GEO.stat().st_size
    data["roadNames"] = roads
    data["sameCorridorM"] = SAME_CORRIDOR_M
    data["labelNote"] = NOTE
    GEO.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"\nmerged into {GEO.name}: {before/1048576:.1f} MB -> "
          f"{GEO.stat().st_size/1048576:.1f} MB "
          f"({len(roads)} interned road names)")

    if SEGS.exists():                    # keep the sibling export in step
        alt = json.loads(SEGS.read_text(encoding="utf-8"))
        for s in alt.get("items", []):
            s.pop("nd", None)
            nd = by_id.get(s["id"])
            if nd:
                s["nd"] = nd
        alt["roadNames"] = roads
        alt["sameCorridorM"] = SAME_CORRIDOR_M
        alt["labelNote"] = NOTE
        SEGS.write_text(json.dumps(alt, ensure_ascii=False), encoding="utf-8")
        print(f"  and {SEGS.name} kept in step")
    # The cases page shows one segment at a time and must not download the 9 MB
    # collection for a label, so the composed string is stamped in here instead.
    cases = WEB / "ponding-cases.json"
    if cases.exists():
        cj = json.loads(cases.read_text(encoding="utf-8"))
        stamped = 0
        for c in cj.get("items", []):
            seg = c.get("segment")
            if not seg or seg.get("name"):
                continue
            nd = by_id.get(seg.get("id"))
            seg.pop("nameDerived", None)
            if nd:
                i, m = nd
                seg["nameDerived"] = (f"امتداد {roads[i]}" if m <= SAME_CORRIDOR_M
                                      else f"قرب {roads[i]} — {m} م")
                stamped += 1
        cases.write_text(json.dumps(cj, ensure_ascii=False), encoding="utf-8")
        print(f"  stamped {stamped} derived labels into {cases.name}")

    shard_segments(data)

    if OUT.exists():
        OUT.unlink()
        print(f"removed the standalone {OUT.name}")


if __name__ == "__main__":
    main()
