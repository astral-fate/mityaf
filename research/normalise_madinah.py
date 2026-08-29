# -*- coding: utf-8 -*-
"""Which normalisation should Madinah inference use? Measure it, do not assume.

normalise.py chose per-city rank normalisation of the DEM block because it won
on US cross-city transfer (+7.4%). That is the right evidence for training. It
is NOT evidence about how to prepare MADINAH at inference time, and there is a
population mismatch hiding in the gap:

    training saw   GRID CELLS   -- a uniform lattice over each city
    inference gets ROAD SEGMENTS -- pieces of road, 30,337 of them

Those are different populations of the same city. Median road_density is 14.4
across Madinah's grid cells and 19.3 across its road segments, because roads sit
where roads are. So a percentile computed among segments does not mean what a
percentile computed among grid cells meant during training, and road_density --
the model's heaviest feature -- is passed raw and shifted.

Five candidate preparations, scored on the only Madinah ground truth there is:

    raw              no normalisation at all
    dem_seg          rank the DEM block among the 30,337 segments  (what we do)
    dem_grid         rank the DEM block against the Madinah GRID distribution,
                     which is the population training actually saw
    all_seg          rank all nine among the segments
    all_grid         rank all nine against the grid distribution

The hydrology ranking is unaffected by any of this -- it is computed natively
from Madinah terrain and never sees a US model -- so it appears as the constant
to beat.

    .venv/Scripts/python.exe normalise_madinah.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata

from domain_adapt import DEM
from incident_register import COORD_QUALITY, REPORTS
from train_and_save import STORE, load, predict
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_normalise_madinah.json"
RNG = np.random.default_rng(11)
DRAWS = 200_000


def rank_within(X, cols):
    """Percentile of each value among the rows of X itself."""
    Z = X.copy()
    for j in cols:
        Z[:, j] = rankdata(X[:, j]) / len(X)
    return Z


def rank_against(X, ref, cols):
    """Percentile of each value within a REFERENCE distribution.

    This is the piece that matches inference to training: the reference is the
    Madinah grid, which is the same kind of population the US cities were
    gridded into.
    """
    Z = X.copy()
    for j in cols:
        r = np.sort(ref[:, j])
        Z[:, j] = np.searchsorted(r, X[:, j], side="right") / len(r)
    return Z


def main() -> None:
    grid = build_matrix("madinah")
    keys = list(grid[3])
    Xgrid = grid[0]
    dem = [i for i, k in enumerate(keys) if k in DEM]
    allc = list(range(len(keys)))

    seg = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    X = seg[keys].to_numpy("float32")
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")

    df = pd.DataFrame(REPORTS, columns=["date", "district", "place", "source",
                                        "stream", "lat", "lon"])
    pts = sorted({(r.lat, r.lon) for r in df.dropna(subset=["lat"]).itertuples()})
    idx = [int(((seg.lat - la) ** 2 + (seg.lon - lo) ** 2).idxmin()) for la, lo in pts]
    isp = np.array([COORD_QUALITY.get(q) == "precise" for q in pts])
    print(f"ground truth: {len(pts)} locations, {int(isp.sum())} precise\n")

    preps = {
        "raw":      X,
        "dem_seg":  rank_within(X, dem),
        "dem_grid": rank_against(X, Xgrid, dem),
        "all_seg":  rank_within(X, allc),
        "all_grid": rank_against(X, Xgrid, allc),
    }

    saved = sorted(q.stem for q in STORE.glob("*.joblib") if q.stem != "always_negative")
    print(f"{len(saved)} saved models: {', '.join(saved)}\n")

    hyd = risk.set_index("unit_id").reindex(seg.unit_id)["rank_hydrology"].to_numpy()
    hp = hyd[idx][isp]
    print(f"{'hydrology (ships)':22}{'precise':>10}{'all':>9}   "
          f"{np.nanmean(hp):.3f}   {np.nanmean(hyd[idx]):.3f}\n")

    res = {}
    print(f"{'preparation':12}{'model':20}{'precise(3)':>12}{'all(6)':>9}{'p':>9}")
    for pname, Xp in preps.items():
        res[pname] = {}
        for m in saved:
            try:
                p = predict(m, Xp, keys)
            except Exception as e:                                # noqa: BLE001
                continue
            r = rankdata(p) / len(p)
            rp, ra = r[idx][isp], r[idx]
            draws = RNG.choice(r, size=(DRAWS, len(rp)))
            pv = float((draws.mean(axis=1) >= rp.mean()).mean())
            res[pname][m] = {"precise": float(rp.mean()), "all": float(ra.mean()),
                             "p": pv, "ranks": [round(float(v), 3) for v in rp]}
        if not res[pname]:
            continue
        best = max(res[pname], key=lambda k: res[pname][k]["precise"])
        b = res[pname][best]
        star = "  *" if b["p"] < 0.05 else ""
        mean_all = np.mean([v["precise"] for v in res[pname].values()])
        print(f"{pname:12}{'best: ' + best:20}{b['precise']:12.3f}"
              f"{b['all']:9.3f}{b['p']:9.4f}{star}")
        print(f"{'':12}{'mean of all models':20}{mean_all:12.3f}")

    print("\n" + "=" * 72)
    print("Which preparation is right?")
    print("=" * 72)
    ranked = sorted(res, key=lambda k: -np.mean([v["precise"] for v in res[k].values()])
                    if res[k] else 0)
    for k in ranked:
        if not res[k]:
            continue
        m = np.mean([v["precise"] for v in res[k].values()])
        print(f"  {k:10} mean precise-pin rank across models: {m:.3f}")
    print("\n  dem_grid is the one that MATCHES TRAINING: the US models learned")
    print("  percentiles within a city's grid, so Madinah percentiles should be")
    print("  computed against Madinah's grid, not against its road segments.")
    print("  If dem_seg beats it here that is a 3-point result, not a reason to")
    print("  keep the mismatched preparation.")

    OUT.write_text(json.dumps(
        {"n_points": len(pts), "n_precise": int(isp.sum()), "draws": DRAWS,
         "hydrology_precise": float(np.nanmean(hp)),
         "preparations": res}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
