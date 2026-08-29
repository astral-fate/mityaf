"""Phase 3 — presence-only framing: the negatives are not verified dry.

A cell with no complaint is unreported, not confirmed dry. Treating it as a
negative is an assumption the pipeline currently makes silently, and the
borough skew is direct evidence it is wrong -- Queens files 8,169 street-flood
complaints against Manhattan's 1,465, which the literature attributes to
combined versus separate sewers rather than to Manhattan being dry.

Two established corrections:

  Elkan & Noto (2008)  estimate c = P(labelled | truly positive) from held-out
      positives, then divide predicted scores by it. Note what this can and
      cannot do: dividing every score by one constant is a monotonic transform,
      so it changes calibration and leaves the ranking untouched. Since the
      platform consumes a percentile rank, this cannot move our metrics -- and
      demonstrating that is the point, not a disappointment.

  Bagging-PU  repeatedly draw a same-sized sample of unlabelled cells as
      pseudo-negatives and average across rounds. This genuinely can change the
      ranking, because each round sees a different negative set.

The estimated c is worth as much as the models: it is a per-city estimate of
what fraction of genuinely flood-prone cells ever got reported.

    .venv/Scripts/python.exe pu_learning.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score
from sklearn.model_selection import GroupKFold

import models as M
from cities import CITIES
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_pu.json"
SEEDS = [42, 1, 7]
MODEL = "catboost"


def skill(y, p) -> float:
    ap, b = float(average_precision_score(y, p)), float(y.mean())
    return (ap - b) / (1.0 - b)


def estimate_c(X, y, block, seed) -> float:
    """P(labelled | truly positive), via Elkan & Noto's held-out estimator.

    Fit on part of the data, then read the mean predicted score on positives the
    model never saw. If reporting were complete that mean would approach 1; how
    far below 1 it sits is how much of the phenomenon goes unreported.
    """
    cs = []
    for tr, te in GroupKFold(n_splits=5).split(X, y, block):
        pos_te = te[y[te] == 1]
        if len(pos_te) < 20:
            continue
        est = M.build(MODEL, y[tr], seed)
        M.fit(est, X[tr], y[tr], MODEL)
        cs.append(float(est.predict_proba(X[pos_te])[:, 1].mean()))
    return float(np.mean(cs)) if cs else float("nan")


def bagging_pu(Xtr, ytr, Xte, seed, rounds=15):
    """Average scores over `rounds` draws of pseudo-negatives."""
    rng = np.random.default_rng(seed)
    pos = np.where(ytr == 1)[0]
    unl = np.where(ytr == 0)[0]
    acc = np.zeros(len(Xte))
    for r in range(rounds):
        take = rng.choice(unl, min(len(pos), len(unl)), replace=False)
        idx = np.concatenate([pos, take])
        yb = np.concatenate([np.ones(len(pos)), np.zeros(len(take))]).astype("int8")
        est = M.build(MODEL, yb, seed + r)
        M.fit(est, Xtr[idx], yb, MODEL)
        acc += est.predict_proba(Xte)[:, 1]
    return acc / rounds


def main() -> None:
    data = {c: build_matrix(c) for c in CITIES if CITIES[c].get("labels_url")
            and (HERE / "cache" / c / "meta.json").exists()}
    out = {"reporting_completeness": {}, "transfer": {}}

    # ── how complete is each city's reporting? ─────────────────────────────
    print("\nestimated reporting completeness  c = P(reported | flood-prone)\n")
    for c, (X, y, block, _, meta) in data.items():
        cs = [estimate_c(X, y, block, s) for s in SEEDS]
        m, sd = float(np.mean(cs)), float(np.std(cs))
        out["reporting_completeness"][c] = {"c": m, "sd": sd,
                                            "prevalence": float(y.mean()),
                                            "implied_true_prevalence":
                                                float(y.mean()) / m if m else None}
        print(f"  {meta['name']:16} c = {m:.3f} ±{sd:.3f}   "
              f"observed prevalence {y.mean():.3f}  ->  implied true "
              f"{y.mean() / m:.3f}")

    # ── does the PU framing change the ranking? ────────────────────────────
    print("\nleave-one-city-out transfer skill\n")
    for label in ("standard", "elkan_noto", "bagging_pu"):
        per = {}
        for held in data:
            tr = [c for c in data if c != held]
            Xtr = np.vstack([data[c][0] for c in tr])
            ytr = np.concatenate([data[c][1] for c in tr])
            Xte, yte = data[held][0], data[held][1]
            runs = []
            for s in SEEDS:
                if label == "bagging_pu":
                    p = bagging_pu(Xtr, ytr, Xte, s)
                else:
                    est = M.build(MODEL, ytr, s)
                    M.fit(est, Xtr, ytr, MODEL)
                    p = est.predict_proba(Xte)[:, 1]
                    if label == "elkan_noto":
                        # the correction itself: divide by the estimated
                        # labelling propensity of the TRAINING pool.
                        #
                        # Deliberately NOT clipped to [0,1]. Clipping looks
                        # tidier -- p/c exceeds 1 wherever p > c -- but it
                        # collapses every such cell into a tie at 1.0 and
                        # destroys the ranking among exactly the cells we care
                        # most about. That clipping, not the correction, was
                        # what appeared to cost 0.018 skill in the first run.
                        c = np.mean([out["reporting_completeness"][t]["c"]
                                     for t in tr])
                        p = p / c
                runs.append(skill(yte, p))
            per[held] = float(np.mean(runs))
        m = float(np.mean(list(per.values())))
        out["transfer"][label] = {"mean_skill": m, "per_city": per}
        print(f"  {label:14} {m:+.4f}   "
              + "  ".join(f"{c}={per[c]:+.3f}" for c in per))

    d = out["transfer"]
    print(f"\n  elkan_noto vs standard : "
          f"{d['elkan_noto']['mean_skill'] - d['standard']['mean_skill']:+.6f}"
          f"   (a monotonic rescale cannot move a ranking metric)")
    print(f"  bagging_pu vs standard : "
          f"{d['bagging_pu']['mean_skill'] - d['standard']['mean_skill']:+.4f}")

    OUT.write_text(json.dumps(out, indent=1))
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
