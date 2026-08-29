# -*- coding: utf-8 -*-
"""One table: 14 models trained on US cities, inferred on Madinah, scored on
the 11 locations we have proof flooded.

Every metric is computed by treating the 11 known flood sites as positives and
the other 30,326 segments as negatives, which is the standard positives-only
convention. Two of the columns need a word of interpretation and both are
printed anyway rather than withheld:

  PRECISION is capped by the label count, not by the model. There are 11
  positives, so precision@100 can never exceed 11/100 = 0.11 even for a perfect
  ranker. The theoretical ceiling is printed under the table so each value can
  be read against what was attainable.

  ACCURACY is meaningless at this prevalence -- predicting "no flood" on every
  street scores 99.964% -- so it is printed once, in the header, and not per
  model.

AUC is the column to read. It is unaffected by the label count and 0.500 is
exactly chance.

    .venv/Scripts/python.exe report_inference.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata
from sklearn.metrics import average_precision_score, roc_auc_score

from domain_adapt import DEM
from incident_register import COORD_QUALITY, REPORTS
from normalise_madinah import rank_against
from train_and_save import STORE, load, predict
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_inference_report.json"
RNG = np.random.default_rng(5)
DRAWS = 200_000
PKS = [100, 500, 1000]
RKS = [1, 5, 10, 20]


def score_all(r: np.ndarray, y: np.ndarray) -> dict:
    """r = percentile rank of every segment, y = 1 for the known flood sites."""
    n_pos = int(y.sum())
    order = np.argsort(-r)
    out = {"auc": float(roc_auc_score(y, r)),
           "ap": float(average_precision_score(y, r)),
           "mean_rank": float(r[y == 1].mean()),
           "median_rank": float(np.median(r[y == 1])),
           "worst_rank": float(r[y == 1].min())}
    draws = RNG.choice(r, size=(DRAWS, n_pos))
    out["p"] = float((draws.mean(axis=1) >= out["mean_rank"]).mean())
    for k in PKS:
        hits = int(y[order[:k]].sum())
        out[f"P@{k}"] = hits / k
        out[f"hits@{k}"] = hits
    for k in RKS:
        cut = int(len(r) * k / 100)
        out[f"R@{k}%"] = int(y[order[:cut]].sum()) / n_pos
    # best F1 over every threshold on the ranking
    tp = np.cumsum(y[order])
    idx = np.arange(1, len(r) + 1)
    f1 = 2 * tp / (idx + n_pos)
    b = int(np.argmax(f1))
    out["best_f1"] = float(f1[b])
    out["best_f1_at_k"] = b + 1
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
    y = np.zeros(len(seg), dtype=int)
    y[idx] = 1
    n_pos = int(y.sum())

    print(f"\nINFERENCE ON THE MADINAH GROUND TRUTH")
    print(f"  {len(seg):,} street segments scored   |   {n_pos} confirmed flood "
          f"locations   |   prevalence {y.mean():.4%}")
    print(f"  models trained on New York, Chicago, San Francisco and Dallas; "
          f"none has seen a Madinah label")
    print(f"  always-say-no accuracy here: {1 - y.mean():.4%}  (why accuracy is "
          f"not a column)\n")

    rows = []
    for name in sorted(q.stem for q in STORE.glob("*.joblib")):
        try:
            p = predict(name, X, keys)
        except Exception as e:                                    # noqa: BLE001
            print(f"  {name} skipped: {type(e).__name__}: {e}")
            continue
        r = rankdata(p) / len(p)
        m = score_all(r, y)
        m["model"] = name
        rows.append(m)

    hyd = np.nan_to_num(
        risk.set_index("unit_id").reindex(seg.unit_id)["rank_hydrology"].to_numpy(),
        nan=0.5)
    h = score_all(hyd, y)
    h["model"] = "hydrology (no training)"
    rows.append(h)

    rows.sort(key=lambda x: -x["auc"])
    print("=" * 104)
    print(f"{'model':24}{'AUC':>7}{'p':>8}{'AP':>7}"
          + "".join(f"{'R@' + str(k) + '%':>7}" for k in RKS)
          + "".join(f"{'P@' + str(k):>8}" for k in PKS)
          + f"{'bestF1':>8}{'median':>8}")
    print("=" * 104)
    for m in rows:
        star = "*" if m["p"] < 0.05 else " "
        print(f"{m['model']:24}{m['auc']:7.3f}{m['p']:7.4f}{star}{m['ap']:7.4f}"
              + "".join(f"{m[f'R@{k}%']:7.2f}" for k in RKS)
              + "".join(f"{m[f'P@{k}']:8.3f}" for k in PKS)
              + f"{m['best_f1']:8.3f}{m['median_rank']:8.3f}")
    print("=" * 104)
    print(f"\nPRECISION CEILING with {n_pos} positives: "
          + "   ".join(f"P@{k} <= {n_pos / k:.3f}" for k in PKS))
    print(f"AP under a random ranking would be {y.mean():.5f}; "
          f"AUC under random is 0.500.")

    OUT.write_text(json.dumps({"n_segments": int(len(seg)), "n_positive": n_pos,
                               "prevalence": float(y.mean()), "draws": DRAWS,
                               "results": rows}, indent=1, ensure_ascii=False),
                   encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
