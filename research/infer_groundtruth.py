# -*- coding: utf-8 -*-
"""Run every trained model over Madinah, and score it on the real flood sites.

Every model in the bake-off has so far been judged on American labels. This
judges them on the only Madinah ground truth that exists: the places a resident
or a post says water actually stood.

Weights come from `models_store/`, written once by train_and_save.py -- nothing
is refitted here. Each candidate scores all 30,337 Madinah segments, the scores
become percentiles, and we read off the rank of every known flood location. The
hydrology ranking that ships is included as the incumbent to beat.

READ THE MULTIPLE-COMPARISONS WARNING IN THE OUTPUT. There are three precise
ground-truth points. Comparing fourteen models against three points will
produce a winner whatever the truth is -- the expected best-of-14 mean rank
under a pure null is around 0.85, which is close to what a genuinely good model
would score. This table is therefore a screen, not a selection: it can tell you
that a model is no better than chance, and it cannot reliably tell you which of
two good ones is better.

    .venv/Scripts/python.exe infer_groundtruth.py
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata

from domain_adapt import DEM, rank_norm
from incident_register import COORD_QUALITY, REPORTS
from train_and_save import STORE, load, predict

HERE = Path(__file__).parent
OUT = HERE / "results_groundtruth_inference.json"
SEED = 42
RNG = np.random.default_rng(7)
DRAWS = 200_000


def null_p(ranks_all: np.ndarray, obs_mean: float, n: int) -> float:
    draws = RNG.choice(ranks_all, size=(DRAWS, n))
    return float((draws.mean(axis=1) >= obs_mean).mean())


def main() -> None:
    saved = sorted(q.stem for q in STORE.glob("*.joblib"))
    if not saved:
        raise SystemExit("models_store is empty -- run train_and_save.py first")
    keys = load(saved[0])[1]["feature_order"]
    dem = [i for i, k in enumerate(keys) if k in DEM]
    print(f"\nloaded {len(saved)} saved models from {STORE.name}/ -- nothing refitted")

    seg = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    Xseg = rank_norm(seg[keys].to_numpy("float32"), dem)
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")

    df = pd.DataFrame(REPORTS, columns=["date", "district", "place", "source",
                                        "stream", "lat", "lon"])
    pts = sorted({(r.lat, r.lon) for r in df.dropna(subset=["lat"]).itertuples()})
    prec = [q for q in pts if COORD_QUALITY.get(q) == "precise"]
    print(f"ground truth: {len(pts)} distinct locations, {len(prec)} precise")

    idx = [int(((seg.lat - la) ** 2 + (seg.lon - lo) ** 2).idxmin())
           for la, lo in pts]
    is_prec = np.array([COORD_QUALITY.get(q) == "precise" for q in pts])

    rows = []

    # the incumbent, for reference -- no training involved
    hyd = risk.set_index("unit_id").reindex(seg.unit_id)["rank_hydrology"].to_numpy()
    r_all, r_prec = hyd[idx], hyd[idx][is_prec]
    rows.append({"model": "hydrology (ships)", "trained": False,
                 "mean_all": float(np.nanmean(r_all)),
                 "mean_precise": float(np.nanmean(r_prec)),
                 "p_precise": null_p(hyd[~np.isnan(hyd)], float(np.nanmean(r_prec)), len(r_prec)),
                 "ranks_precise": [round(float(v), 3) for v in r_prec],
                 "score_s": 0.0})

    print(f"scoring {len(Xseg):,} Madinah segments with each\n")

    for name in saved:
        if name == "always_negative":
            continue
        t0 = time.time()
        try:
            p = predict(name, Xseg, keys)
        except Exception as e:                                    # noqa: BLE001
            print(f"  {name:20} SKIPPED — {type(e).__name__}: {e}")
            continue
        r = rankdata(p) / len(p)
        ra, rp = r[idx], r[idx][is_prec]
        rows.append({"model": name, "trained": True,
                     "mean_all": float(ra.mean()), "mean_precise": float(rp.mean()),
                     "p_precise": null_p(r, float(rp.mean()), len(rp)),
                     "ranks_precise": [round(float(v), 3) for v in rp],
                     "score_s": round(time.time() - t0, 1)})
        print(f"  {name:20} precise {rp.mean():.3f}   all {ra.mean():.3f}   "
              f"({time.time() - t0:.0f}s)")

    rows.sort(key=lambda r: -r["mean_precise"])
    print("\n" + "=" * 78)
    print("INFERENCE ON THE MADINAH GROUND TRUTH — ranked by the precise pins")
    print("=" * 78)
    print(f"\n{'model':22}{'precise (n=3)':>15}{'all (n=6)':>12}{'p':>9}   the three ranks")
    for r in rows:
        star = "  *" if r["p_precise"] < 0.05 else ""
        print(f"{r['model']:22}{r['mean_precise']:15.3f}{r['mean_all']:12.3f}"
              f"{r['p_precise']:9.4f}{star}   "
              + "  ".join(f"{v:.3f}" for v in r["ranks_precise"]))

    # what does "best of N" look like under a pure null?
    n = len(prec)
    best_null = RNG.choice(np.linspace(0, 1, 10_000), size=(20_000, len(rows), n)
                           ).mean(axis=2).max(axis=1)
    print(f"\n{'-' * 78}")
    print("MULTIPLE COMPARISONS — read this before picking a winner")
    print(f"  {len(rows)} candidates scored against {n} points.")
    print(f"  Under a pure null, the BEST of {len(rows)} scores a mean of "
          f"{best_null.mean():.3f} (95th pct {np.percentile(best_null, 95):.3f}).")
    print(f"  So any model below about {np.percentile(best_null, 95):.2f} here is "
          f"indistinguishable from chance,")
    print("  and the ordering among the top few carries no information.")

    OUT.write_text(json.dumps(
        {"seed": SEED, "n_points": len(pts), "n_precise": n,
         "n_candidates": len(rows), "draws": DRAWS,
         "best_of_n_null_mean": float(best_null.mean()),
         "best_of_n_null_p95": float(np.percentile(best_null, 95)),
         "results": rows}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
