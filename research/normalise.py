"""Phase 4b — rescue the terrain features by making them city-relative.

The ablation found that the six DEM features score BELOW random across cities
(-0.004) while working fine within one (+0.103). The likely reason is that they
are absolute measurements whose meaning is relative to local topography: two
degrees of slope is flat in San Francisco and steep in Chicago, so a rule
learned in one city is wrong in the other, not merely weaker.

If that is the cause, converting each terrain feature to its percentile rank
*within its own city* should fix it -- "steeper than 80% of this city" carries
the same meaning everywhere. The urban features are left alone, because road
density in km/km-squared already means the same thing in every city.

This matters for Madinah specifically: a percentile rank needs no labels, only
the city's own feature distribution, so it is computable there.

    .venv/Scripts/python.exe normalise.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.stats import rankdata
from sklearn.metrics import average_precision_score

import models as M
from cities import CITIES
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_normalise.json"
SEEDS = [42, 1, 7]
DEM = {"slope", "sink", "logacc", "twi", "hand", "relelev"}


def rank_norm(X: np.ndarray, cols) -> np.ndarray:
    Z = X.copy()
    for j in cols:
        Z[:, j] = rankdata(X[:, j]) / len(X)
    return Z


def loco(data, cols, seed, model="catboost") -> dict:
    per = {}
    for held in data:
        tr = [c for c in data if c != held]
        Xtr = np.vstack([data[c][0][:, cols] for c in tr])
        ytr = np.concatenate([data[c][1] for c in tr])
        Xte, yte = data[held][0][:, cols], data[held][1]
        est = M.build(model, ytr, seed)
        M.fit(est, Xtr, ytr, model)
        ap = float(average_precision_score(yte, est.predict_proba(Xte)[:, 1]))
        b = float(yte.mean())
        per[held] = (ap - b) / (1.0 - b)
    return per


def main() -> None:
    raw = {c: build_matrix(c) for c in CITIES if CITIES[c].get("labels_url")
           and (HERE / "cache" / c / "meta.json").exists()}
    keys = next(iter(raw.values()))[3]
    idx = {k: i for i, k in enumerate(keys)}
    dem_cols = [idx[k] for k in keys if k in DEM]
    allc = list(range(len(keys)))

    dem_norm = {c: (rank_norm(d[0], dem_cols), *d[1:]) for c, d in raw.items()}
    all_norm = {c: (rank_norm(d[0], allc), *d[1:]) for c, d in raw.items()}

    configs = [
        ("DEM only, raw", raw, dem_cols),
        ("DEM only, rank-normalised", dem_norm, dem_cols),
        ("all nine, raw", raw, allc),
        ("all nine, DEM normalised", dem_norm, allc),
        ("all nine, everything normalised", all_norm, allc),
    ]

    print(f"\nper-city rank normalisation — catboost, {len(raw)} cities, "
          f"{len(SEEDS)} seeds\n")
    out = {}
    for label, data, cols in configs:
        runs = [loco(data, cols, s) for s in SEEDS]
        means = [float(np.mean(list(r.values()))) for r in runs]
        per = {c: float(np.mean([r[c] for r in runs])) for c in raw}
        out[label] = {"mean_skill": float(np.mean(means)),
                      "sd": float(np.std(means)), "per_city": per}
        print(f"  {label:33} {np.mean(means):+.4f} ±{np.std(means):.4f}   "
              + "  ".join(f"{c}={per[c]:+.3f}" for c in per))

    base = out["all nine, raw"]["mean_skill"]
    best = out["all nine, DEM normalised"]["mean_skill"]
    out["delta_vs_raw"] = best - base
    print(f"\n  normalising the terrain block: {best - base:+.4f} skill "
          f"({100 * (best - base) / base:+.1f}%)")

    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.name}")


if __name__ == "__main__":
    main()
