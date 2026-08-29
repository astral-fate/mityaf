"""Score Al Madinah using Al Madinah's own data, three independent ways.

The benchmark established two things that change how this city should be scored.
First, ranking streets by road density alone, with no training and no labels at
all, reaches skill 0.177 against the full trained model's 0.186 -- so a
label-free ranking is not a fallback, it is within noise of the pipeline.
Second, absolute terrain values do not transfer between cities, but their
percentile ranks do, and a percentile rank needs only the city's own
distribution.

So we produce three rankings and, crucially, report where they agree:

  A  road density, percentile-ranked within Madinah. No training whatsoever.
  B  a classical hydrological composite (TWI + sink - HAND - slope), each term
     percentile-ranked within Madinah. No training whatsoever.
  C  CatBoost fitted on all four labelled cities in the best configuration
     found (terrain rank-normalised per city), then applied to Madinah with
     Madinah's OWN percentiles.

None of the three can be validated here -- the city has no labels, which is the
entire premise. Agreement between methods that fail in different ways is
therefore the only evidence available, and it is reported honestly as
corroboration rather than as accuracy.

    .venv/Scripts/python.exe score_madinah_native.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata, spearmanr

import models as M
from cities import CITIES
from ood import mahalanobis
from train_multi import build_matrix

HERE = Path(__file__).parent
FEATURES_CSV = HERE / "out" / "madinah_segments_features.csv"
OUT_CSV = HERE / "out" / "madinah_native_risk.csv"
OUT_JSON = HERE / "results_madinah_native.json"

DEM = ["slope", "sink", "logacc", "twi", "hand", "relelev"]
SEED = 42


def pct(v: np.ndarray) -> np.ndarray:
    """Percentile rank within this city, in [0, 1]."""
    return rankdata(v) / len(v)


def main() -> None:
    df = pd.read_csv(FEATURES_CSV)
    df.columns = [c.lstrip("﻿") for c in df.columns]

    labelled = [c for c in CITIES if CITIES[c].get("labels_url")
                and (HERE / "cache" / c / "meta.json").exists()]
    data = {c: build_matrix(c) for c in labelled}
    keys = next(iter(data.values()))[3]
    dem_idx = [keys.index(k) for k in DEM]

    X = df[keys].astype(float)
    n_filled = int(X.isna().any(axis=1).sum())
    X = X.fillna(X.median(numeric_only=True)).to_numpy()

    # ── A: unsupervised, road density only ─────────────────────────────────
    rank_a = pct(X[:, keys.index("road_density")])

    # ── B: unsupervised, classical hydrology ───────────────────────────────
    rank_b = pct(pct(X[:, keys.index("twi")])
                 + pct(X[:, keys.index("sink")])
                 - pct(X[:, keys.index("hand")])
                 - pct(X[:, keys.index("slope")]))

    # ── C: transferred model, terrain normalised per city on both sides ────
    def norm(A):
        Z = A.copy()
        for j in dem_idx:
            Z[:, j] = pct(A[:, j])
        return Z

    Xtr = np.vstack([norm(data[c][0]) for c in labelled])
    ytr = np.concatenate([data[c][1] for c in labelled])
    est = M.build("catboost", ytr, SEED)
    M.fit(est, Xtr, ytr, "catboost")
    rank_c = pct(est.predict_proba(norm(X))[:, 1])

    # ── coverage: is Madinah inside the training envelope? ─────────────────
    raw_tr = np.vstack([data[c][0] for c in labelled])
    dist = mahalanobis(raw_tr, X)
    thresh = float(np.quantile(mahalanobis(raw_tr, raw_tr), 0.99))
    ood = dist > thresh

    # ── agreement between methods that fail differently ────────────────────
    pairs = {"A_roaddensity vs C_model": spearmanr(rank_a, rank_c),
             "B_hydrology  vs C_model": spearmanr(rank_b, rank_c),
             "A_roaddensity vs B_hydrology": spearmanr(rank_a, rank_b)}
    print("\nrank agreement (Spearman)\n")
    for k, (r, p) in pairs.items():
        print(f"  {k:30}{r:+.3f}")

    top = max(1, int(0.05 * len(df)))
    def overlap(u, v):
        a = set(np.argsort(-u)[:top])
        return len(a & set(np.argsort(-v)[:top])) / top
    print(f"\ntop-{top} ({0.05:.0%}) overlap\n")
    print(f"  road density vs model     {overlap(rank_a, rank_c):.1%}")
    print(f"  hydrology    vs model     {overlap(rank_b, rank_c):.1%}")
    print(f"  road density vs hydrology {overlap(rank_a, rank_b):.1%}")

    # consensus: mean of the three ranks, then re-ranked
    consensus = pct(rank_a + rank_b + rank_c)
    agree = 1.0 - (np.vstack([rank_a, rank_b, rank_c]).std(axis=0)
                   / 0.5)          # 0.5 is the max sd of three ranks in [0,1]

    out = df[["unit_id", "name_ar", "district_ar", "lon", "lat"]].copy()
    out["rank_roaddensity"] = rank_a
    out["rank_hydrology"] = rank_b
    out["rank_model"] = rank_c
    out["rank_consensus"] = consensus
    out["method_agreement"] = np.clip(agree, 0, 1)
    out["ood_flag"] = ood.astype(int)
    out["mahalanobis"] = dist
    out.sort_values("rank_consensus", ascending=False, inplace=True)
    OUT_CSV.parent.mkdir(exist_ok=True)
    out.to_csv(OUT_CSV, index=False, encoding="utf-8")

    summary = {
        "n_segments": int(len(df)),
        "median_filled_features": n_filled,
        "spearman": {k: float(v[0]) for k, v in pairs.items()},
        "top5pct_overlap": {
            "roaddensity_vs_model": overlap(rank_a, rank_c),
            "hydrology_vs_model": overlap(rank_b, rank_c),
            "roaddensity_vs_hydrology": overlap(rank_a, rank_b)},
        "ood_fraction": float(ood.mean()),
        "ood_threshold": thresh,
        "note": "No Madinah labels exist. Agreement is corroboration, not accuracy.",
    }
    OUT_JSON.write_text(json.dumps(summary, indent=1))

    print(f"\n  segments scored          {len(df):,}")
    print(f"  median-filled features   {n_filled:,}")
    print(f"  flagged out-of-coverage  {ood.sum():,} ({ood.mean():.1%})")
    print(f"  high consensus (>0.8)    {(consensus > 0.8).sum():,}")
    print(f"\nwrote {OUT_CSV.name} and {OUT_JSON.name}")


if __name__ == "__main__":
    main()
