# -*- coding: utf-8 -*-
"""Can anything other than the elevation model find the underpasses?

The tunnel rule exists because the DEM measures the deck spanning the road, not
the road: 38 of the 47 ways are invisible to rule 1. But six of the nine trained
features ARE that same elevation model, and the other three describe urban form
(road density, share of major roads, load per road). So the question worth
asking is not «do the models agree with the tag» -- it is:

    at these exact segments, does ANY signal that is not the DEM notice them?

Two things are measured here, on the same rows:

  per-feature     where the tunnel segments sit in each feature's own
                  distribution across all 30,337. A DEM feature that reads near
                  the 50th percentile is saying «ordinary ground» -- blind. An
                  urban-form feature that reads high is saying «big busy road»
                  -- which is what an underpass actually is.
  per-model       where each of the 14 saved models ranks them. A model that
                  leans on urban form should place them higher than one that
                  leans on terrain, and that difference is the answer.

Note the models were trained on grid cells and are being applied to road
segments, so scores are read as percentile ranks within Madinah's own segment
distribution -- never as probabilities. Same convention as the rest of the work.

    .venv/Scripts/python.exe tunnels_vs_models.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from train_and_save import predict

HERE = Path(__file__).parent
OUT = HERE / "results_tunnels_vs_models.json"

DEM = ["slope", "twi", "sink", "hand", "logacc", "relelev"]
OSM = ["road_density", "major_frac", "load_per_road"]
FEATS = sorted(DEM + OSM)                 # the stored feature_order is sorted


def pct_rank(series, mask):
    """Percentile of the masked rows within the whole column, 0-1."""
    r = series.rank(pct=True)
    return float(r[mask].median())


def main() -> None:
    f = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    f.columns = [c.lstrip("﻿") for c in f.columns]
    tun = pd.read_csv(HERE / "out" / "shortlist" / "type3_tunnels.csv")

    # unit_id is seg_<osm way id>_<nn>; one way becomes several segments
    way_of = f.unit_id.str.extract(r"^seg_(\d+)_", expand=False).astype("Int64")
    mask = way_of.isin(set(tun.osm_id))
    print(f"{int(mask.sum())} segments belong to the {len(tun)} tunnel ways "
          f"(of {len(f)} total)")

    # ── 1. what each feature says at those segments ─────────────────────────
    print("\nmedian percentile of the tunnel segments, per feature")
    print("  (50 = indistinguishable from an average street)\n")
    per_feat = {}
    for block, cols in (("DEM — elevation model", DEM), ("OSM — urban form", OSM)):
        print(f"  {block}")
        for c in cols:
            p = pct_rank(f[c], mask) * 100
            per_feat[c] = round(p, 1)
            bar = "#" * int(abs(p - 50) / 2.2)
            side = "high" if p >= 50 else "low "
            print(f"    {c:15} {p:5.1f}  {side} {bar}")
        print()

    # ── 2. what each trained model says at those segments ───────────────────
    X = f[FEATS].to_numpy(dtype=np.float32)
    rows = []
    for name in sorted(p.stem for p in (HERE / "models_store").glob("*.joblib")):
        try:
            s = predict(name, X, FEATS)
        except Exception as exc:                                 # noqa: BLE001
            print(f"  {name:16} skipped — {type(exc).__name__}: {exc}")
            continue
        s = pd.Series(s)
        if s.nunique() <= 1:                    # always_negative and friends
            rows.append({"model": name, "pct": None, "note": "constant output"})
            continue
        rows.append({"model": name,
                     "pct": round(pct_rank(s, mask) * 100, 1),
                     "note": None})

    # the shipped ranking, for comparison -- it is not a model
    hyd = pd.read_csv(HERE / "out" / "madinah_segment_risk.csv")
    hyd_pct = None
    if "rank_hydrology" in hyd.columns and len(hyd) == len(f):
        hyd_pct = round(pct_rank(hyd["rank_hydrology"], mask) * 100, 1)

    live = sorted([r for r in rows if r["pct"] is not None],
                  key=lambda r: -r["pct"])
    print("median percentile the model puts the tunnel segments at")
    print("  (higher = the model considers them more at risk)\n")
    if hyd_pct is not None:
        print(f"    {'hydrology (shipped)':22} {hyd_pct:5.1f}   ← not a model")
    for r in live:
        print(f"    {r['model']:22} {r['pct']:5.1f}")
    for r in rows:
        if r["pct"] is None:
            print(f"    {r['model']:22}   —    {r['note']}")

    dem_med = float(np.median([per_feat[c] for c in DEM]))
    osm_med = float(np.median([per_feat[c] for c in OSM]))
    print(f"\n  median DEM feature   {dem_med:5.1f}")
    print(f"  median OSM feature   {osm_med:5.1f}")
    print("\n  " + ("urban form sees them, terrain does not"
                    if osm_med - dem_med > 12 else
                    "no clear separation between the two blocks"))

    OUT.write_text(json.dumps(
        {"n_segments": int(mask.sum()), "n_ways": len(tun),
         "per_feature_pct": per_feat, "dem_median": dem_med,
         "osm_median": osm_med, "hydrology_pct": hyd_pct,
         "models": rows}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
