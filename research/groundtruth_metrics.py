# -*- coding: utf-8 -*-
"""The consolidated metrics table for the Madinah ground-truth evaluation.

One place for every number the paper and the deck quote, computed from a single
run so they cannot drift apart. The evaluation task is: eleven street segments
we have evidence flooded, scored by models trained only on US complaint data,
against the other 30,326 segments as presumed negatives.

Four families of metric, and each answers a different question:

  AUC / AP        does the model rank the known sites above the rest?
  R@K, P@K        operational -- inspect the worst K%, how many do you catch?
  lift            mean predicted probability on the eleven, divided by the
                  model's own city-wide median. This is the metric that catches
                  a model calling the whole city flood-prone: decision_tree
                  scores 11/11 above 0.5 and has a lift of 0.99.
  sign test       of the eleven, how many beat the model's OWN median, tested
                  as binomial(n, 0.5). This is the strictest reading and the
                  one the paper leads with, because it is invariant to a model's
                  overall calibration.

F1 and precision are computed and reported, but the ceiling is printed beside
them: with 11 positives in 30,337 segments, P@100 cannot exceed 0.11 for any
ranker whatsoever, so their absolute values describe the label count and not
the model.

    .venv/Scripts/python.exe groundtruth_metrics.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import binomtest, rankdata
from sklearn.metrics import average_precision_score, roc_auc_score

from domain_adapt import DEM
from incident_register import COORD_QUALITY, REPORTS
from normalise_madinah import rank_against
from train_and_save import STORE, predict
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_groundtruth_metrics.json"
RNG = np.random.default_rng(17)
DRAWS = 200_000


def evaluate(p: np.ndarray, idx, trust_mask) -> dict:
    y = np.zeros(len(p), dtype=int)
    y[idx] = 1
    n = len(idx)
    pos = p[idx]
    med = float(np.median(p))
    r = rankdata(p) / len(p)
    order = np.argsort(-p)

    above = int((pos > med).sum())
    sign = binomtest(above, n, 0.5, alternative="greater").pvalue
    draws = RNG.choice(r, size=(DRAWS, n))
    perm = float((draws.mean(axis=1) >= r[idx].mean()).mean())

    tp = np.cumsum(y[order]); k = np.arange(1, len(p) + 1)
    f1 = 2 * tp / (k + n)
    b = int(np.argmax(f1))

    out = {
        "auc": float(roc_auc_score(y, p)),
        "ap": float(average_precision_score(y, p)),
        "mean_prob": float(pos.mean()),
        "city_median_prob": med,
        "lift_vs_median": float(pos.mean() / med) if med else float("nan"),
        "n_above_own_median": above, "n": n,
        "sign_test_p": float(sign),
        "permutation_p": perm,
        "mean_rank": float(r[idx].mean()),
        "median_rank": float(np.median(r[idx])),
        "best_f1": float(f1[b]), "best_f1_at_k": b + 1,
        "hits_p50": int((pos >= 0.5).sum()),
    }
    for K in (1, 5, 10, 20):
        cut = int(len(p) * K / 100)
        out[f"recall@{K}%"] = int(y[order[:cut]].sum()) / n
    for K in (100, 500, 1000):
        out[f"precision@{K}"] = int(y[order[:K]].sum()) / K
    tp_ = pos[trust_mask]
    out["trustworthy_n"] = int(trust_mask.sum())
    out["trustworthy_mean_prob"] = float(tp_.mean())
    out["trustworthy_above_median"] = int((tp_ > med).sum())
    out["trustworthy_mean_rank"] = float(r[idx][trust_mask].mean())
    return out


def main() -> None:
    grid = build_matrix("madinah")
    keys = list(grid[3])
    dem = [i for i, k in enumerate(keys) if k in DEM]
    seg = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    X = rank_against(seg[keys].to_numpy("float32"), grid[0], dem)
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")

    df = pd.DataFrame(REPORTS, columns=["date", "district", "place", "source",
                                        "stream", "lat", "lon"])
    pts = sorted({(r.lat, r.lon) for r in df.dropna(subset=["lat"]).itertuples()})
    idx = [int(((seg.lat - la) ** 2 + (seg.lon - lo) ** 2).idxmin()) for la, lo in pts]
    trust = np.array([COORD_QUALITY.get(q) in ("exact", "precise") for q in pts])

    res = {}
    for m in sorted(q.stem for q in STORE.glob("*.joblib")):
        try:
            res[m] = evaluate(predict(m, X, keys), idx, trust)
        except Exception as e:                                    # noqa: BLE001
            print(f"  {m} skipped: {type(e).__name__}")
    hyd = np.nan_to_num(
        risk.set_index("unit_id").reindex(seg.unit_id)["rank_hydrology"].to_numpy(), nan=.5)
    res["hydrology (no training)"] = evaluate(hyd, idx, trust)

    order = sorted(res, key=lambda k: -res[k]["auc"])
    print(f"\nMADINAH GROUND-TRUTH EVALUATION — {len(idx)} confirmed flood streets, "
          f"{len(seg):,} segments")
    print(f"prevalence {len(idx)/len(seg):.4%}   |   "
          f"P@100 ceiling {len(idx)/100:.2f}   |   random AUC 0.500\n")
    print(f"{'model':24}{'AUC':>7}{'AP':>8}{'lift':>7}{'above':>8}{'sign p':>9}"
          f"{'R@10%':>7}{'R@20%':>7}{'bestF1':>8}{'trust':>7}")
    print("-" * 96)
    for m in order:
        v = res[m]
        s = "*" if v["sign_test_p"] < 0.05 else " "
        print(f"{m:24}{v['auc']:7.3f}{v['ap']:8.4f}{v['lift_vs_median']:7.2f}"
              f"{v['n_above_own_median']:>5}/{v['n']:<2}{v['sign_test_p']:8.3f}{s}"
              f"{v['recall@10%']:7.2f}{v['recall@20%']:7.2f}{v['best_f1']:8.3f}"
              f"{v['trustworthy_above_median']:>4}/{v['trustworthy_n']}")
    print("-" * 96)
    print("lift  = mean probability on the 11 / the model's own city-wide median.")
    print("        A model that calls the whole city flood-prone scores ~1.00.")
    print("above = how many of the 11 beat that model's own median (chance 5.5/11).")
    print("trust = the same, on the 4 coordinates we trust.")

    OUT.write_text(json.dumps(
        {"n_points": len(idx), "n_trustworthy": int(trust.sum()),
         "n_segments": int(len(seg)), "prevalence": len(idx) / len(seg),
         "draws": DRAWS, "models": res}, indent=1, ensure_ascii=False),
        encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
