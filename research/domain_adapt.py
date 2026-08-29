# -*- coding: utf-8 -*-
"""Can we train on US data but weight it toward Madinah?

The question: US complaint data is all the supervision that exists, but Madinah
does not look like New York. Rather than train on the US and hope, reweight each
US training cell by how much it resembles Madinah, so the model fits the part of
the source distribution that actually transfers.

This is covariate-shift correction (Shimodaira 2000). Estimate the density ratio
w(x) = p_target(x) / p_source(x) with a discriminator: fit a classifier to tell
source cells from target cells on the nine features alone -- no labels involved,
so the target needs none, which is the whole point for Madinah. Then

    w(x) = d(x) / (1 - d(x)),   d(x) = P(target | x)

and refit the ponding model with those sample weights.

The honest part is the validation. We cannot measure skill in Madinah, so
weighting toward it is unfalsifiable on its own. But we CAN run the identical
recipe with a held-out US city standing in for Madinah, where labels exist:
weight the three training cities toward the fourth, and see whether held-out
skill improves. That makes the technique testable before it is ever pointed at
Madinah.

Three arms, same LOCO splits and seeds:
  baseline   -- pooled training, no adaptation
  ranknorm   -- per-city rank normalisation (the incumbent, +7.4% previously)
  iw         -- discriminator importance weighting toward the held-out city
  iw+rank    -- both

    .venv/Scripts/python.exe domain_adapt.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.stats import rankdata
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score
from sklearn.model_selection import cross_val_predict

import models as M
from cities import CITIES
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_domain_adapt.json"
SEEDS = [42, 1, 7]
MODEL = "catboost"                       # the bake-off winner
CLIP = (0.05, 20.0)                      # density ratios are heavy-tailed


DEM = {"slope", "sink", "logacc", "twi", "hand", "relelev"}


def rank_norm(X: np.ndarray, cols) -> np.ndarray:
    """Per-city rank normalisation of the given columns.

    Only the DEM block is normalised. normalise.py established that normalising
    all nine is WORSE than raw (+0.1684 vs +0.1858) while normalising the six
    terrain features alone is better (+0.1995) -- elevation statistics are not
    comparable between cities, road-density statistics are.
    """
    Z = X.copy()
    for j in cols:
        Z[:, j] = rankdata(X[:, j]) / len(X)
    return Z


def skill(y, p) -> float:
    """PR-AUC above prevalence, rescaled to [0,1]. Prevalence spans 13x across
    these cities, so raw PR-AUC is not comparable between them."""
    b = float(np.mean(y))
    return (float(average_precision_score(y, p)) - b) / (1.0 - b)


def importance_weights(Xs: np.ndarray, Xt: np.ndarray, seed: int) -> np.ndarray:
    """w(x) = d(x)/(1-d(x)) from a source-vs-target discriminator.

    Cross-fitted: a discriminator scoring its own training rows is
    overconfident, which drives the ratio to the clip bounds and turns the
    weights into noise. `cross_val_predict` gives every source row an
    out-of-fold probability instead.
    """
    X = np.vstack([Xs, Xt])
    z = np.concatenate([np.zeros(len(Xs)), np.ones(len(Xt))])
    disc = HistGradientBoostingClassifier(
        max_iter=200, learning_rate=0.1, max_depth=6, random_state=seed)
    d = cross_val_predict(disc, X, z, cv=3, method="predict_proba")[:len(Xs), 1]
    d = np.clip(d, 1e-6, 1 - 1e-6)
    w = d / (1.0 - d)
    # Rescale by the class balance of the discrimination problem, so w is a
    # density ratio rather than a posterior-odds ratio.
    w *= len(Xs) / max(len(Xt), 1)
    w = np.clip(w, *CLIP)
    return (w / w.mean()).astype("float64")     # mean 1 keeps effective n stable


def run_arm(data, held, seed, use_rank, use_iw):
    tr = [c for c in data if c != held]
    Xtr = np.vstack([data[c][0] for c in tr])
    ytr = np.concatenate([data[c][1] for c in tr])
    Xte, yte = data[held][0], data[held][1]

    if use_rank:                      # normalise each city on its own ranks
        Xtr = np.vstack([rank_norm(data[c][0], DEM_COLS) for c in tr])
        Xte = rank_norm(Xte, DEM_COLS)

    w = importance_weights(Xtr, Xte, seed) if use_iw else None
    est = M.build(MODEL, ytr, seed)
    if w is not None:
        pos = np.where(ytr == 1, (ytr == 0).sum() / max(ytr.sum(), 1), 1.0)
        est.fit(Xtr, ytr, sample_weight=w * pos)
    else:
        M.fit(est, Xtr, ytr, MODEL)
    return skill(yte, est.predict_proba(Xte)[:, 1]), w


def main() -> None:
    us = [c for c in CITIES if c != "madinah" and CITIES[c].get("labels_url")
          and (HERE / "cache" / c / "meta.json").exists()]
    print(f"source cities: {', '.join(us)}\n")
    full = {c: build_matrix(c) for c in us}
    data = {c: v[:2] for c, v in full.items()}
    keys = next(iter(full.values()))[3]
    global DEM_COLS
    DEM_COLS = [i for i, k in enumerate(keys) if k in DEM]
    print(f"DEM columns normalised: {[keys[i] for i in DEM_COLS]}")

    arms = {"baseline": (False, False), "demnorm": (True, False),
            "iw": (False, True), "iw+demnorm": (True, True)}
    res = {a: {c: [] for c in us} for a in arms}

    print("\nLOCO validation — each city stands in for Madinah in turn\n")
    for seed in SEEDS:
        for held in us:
            for arm, (r, i) in arms.items():
                s, _ = run_arm(data, held, seed, r, i)
                res[arm][held].append(s)
            print(f"  seed {seed}  held-out {held:9} " + "  ".join(
                f"{a} {res[a][held][-1]:+.4f}" for a in arms))

    print(f"\n{'arm':12}{'mean skill':>12}{'sd':>9}   per city")
    summary = {}
    for a in arms:
        allv = [v for c in us for v in res[a][c]]
        per = {c: float(np.mean(res[a][c])) for c in us}
        summary[a] = {"mean_skill": float(np.mean(allv)),
                      "sd": float(np.std(allv)), "per_city": per}
        print(f"{a:12}{np.mean(allv):12.4f}{np.std(allv):9.4f}   " +
              "  ".join(f"{c} {v:+.3f}" for c, v in per.items()))

    base = summary["baseline"]["mean_skill"]
    print(f"\n{'arm':12}{'delta vs baseline':>20}")
    deltas = {}
    for a in arms:
        d = summary[a]["mean_skill"] - base
        deltas[a] = d
        print(f"{a:12}{d:+20.4f}   ({d / abs(base) * 100:+.1f}%)")

    # ── what the weights would look like for the real target ──
    print("\nMadinah as target — weight distribution over pooled US cells")
    mad = build_matrix("madinah")[0]
    Xus = np.vstack([data[c][0] for c in us])
    w = importance_weights(Xus, mad, 42)
    q = np.percentile(w, [1, 25, 50, 75, 99])
    print(f"  pooled US cells: {len(Xus):,}   Madinah cells: {len(mad):,}")
    print(f"  weight percentiles  p1 {q[0]:.3f}  p25 {q[1]:.3f}  "
          f"median {q[2]:.3f}  p75 {q[3]:.3f}  p99 {q[4]:.3f}")
    eff = w.sum() ** 2 / (w ** 2).sum()
    print(f"  effective sample size {eff:,.0f} of {len(Xus):,} "
          f"({eff / len(Xus) * 100:.1f}%)  <- how much data survives reweighting")
    share = {}
    k = 0
    for c in us:
        n = len(data[c][0])
        share[c] = float(w[k:k + n].mean())
        k += n
    print("  mean weight by source city: " +
          "  ".join(f"{c} {v:.3f}" for c, v in share.items()))

    OUT.write_text(json.dumps({
        "model": MODEL, "seeds": SEEDS, "source_cities": us,
        "arms": summary, "delta_vs_baseline": deltas,
        "madinah_target": {
            "n_source_cells": int(len(Xus)), "n_target_cells": int(len(mad)),
            "weight_percentiles": {"p1": q[0], "p25": q[1], "median": q[2],
                                   "p75": q[3], "p99": q[4]},
            "effective_sample_size": float(eff),
            "mean_weight_by_city": share},
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
