# -*- coding: utf-8 -*-
"""Blind test: every saved model scores Madinah, judged on the 11 known sites.

Blind in the strict sense -- not one of these models has ever seen a Madinah
label, because none exist. They were fitted on US complaints, saved to
models_store/, and are loaded here and asked to rank 30,337 streets they have
never encountered. The 11 locations we know flooded are the answer key.

WHICH METRICS ARE REAL, AND WHICH CANNOT EXIST

We have 11 positives and NO confirmed negatives. A street with no report is
unreported, not proven dry. That decides the metric list:

  COMPUTABLE
    AUC        with unreported streets treated as negatives, AUC is exactly the
               mean percentile rank of the 11 positives (Mann-Whitney identity).
               0.50 is chance, 1.00 is perfect. This is the headline.
    Recall@K   of the 11 known sites, how many fall in the top K%. Real recall,
               and the number an inspection team actually cares about.
    p-value    permutation against 200,000 draws of 11 random segments.

  NOT COMPUTABLE, AND REPORTED AS "—"
    Precision  needs to know which flagged streets are NOT flood sites. With 11
               labels among 30,337 segments the best attainable precision at the
               top 10% is 11/3034 = 0.4%, which measures our label count and not
               the model. Quoting it would be worse than omitting it.
    F1         is the harmonic mean of recall and precision, so it inherits the
               same defect.
    Accuracy   predicting "no flood" everywhere scores 99.96% here.

Ranks come from the dem_grid preparation, which normalise_madinah.py showed is
both the best performer and the one that matches how the models were trained.

    .venv/Scripts/python.exe blind_test.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata

from domain_adapt import DEM
from incident_register import COORD_QUALITY, REPORTS
from normalise_madinah import rank_against
from train_and_save import STORE, load, predict
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_blind_test.json"
RNG = np.random.default_rng(3)
DRAWS = 200_000
KS = [1, 5, 10, 20]


def metrics(r: np.ndarray, idx: list[int], label_mask=None) -> dict:
    pos = r[idx] if label_mask is None else r[idx][label_mask]
    n = len(pos)
    auc = float(pos.mean())                    # == Mann-Whitney AUC vs the rest
    draws = RNG.choice(r, size=(DRAWS, n))
    p = float((draws.mean(axis=1) >= auc).mean())
    out = {"n": n, "auc": auc, "median_rank": float(np.median(pos)),
           "worst_rank": float(pos.min()), "p": p}
    for k in KS:
        hit = int((pos >= 1 - k / 100).sum())
        out[f"recall@{k}%"] = hit / n
        out[f"hits@{k}%"] = hit
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

    print(f"\nBLIND TEST — {len(pts)} known flood locations, "
          f"{len(seg):,} segments, {int(trust.sum())} trustworthy coordinates")
    print("no model has ever seen a Madinah label; none exist\n")

    rows = []
    hyd = risk.set_index("unit_id").reindex(seg.unit_id)["rank_hydrology"].to_numpy()
    hyd = np.nan_to_num(hyd, nan=0.5)
    rows.append({"model": "hydrology (ships)", "all": metrics(hyd, idx),
                 "trustworthy": metrics(hyd, idx, trust)})

    saved = [q.stem for q in STORE.glob("*.joblib") if q.stem != "always_negative"]
    for name in sorted(saved):
        try:
            p = predict(name, X, keys)
        except Exception as e:                                    # noqa: BLE001
            print(f"  {name} skipped: {type(e).__name__}"); continue
        r = rankdata(p) / len(p)
        rows.append({"model": name, "all": metrics(r, idx),
                     "trustworthy": metrics(r, idx, trust)})

    for scope, title in (("all", f"ALL {len(pts)} LOCATIONS"),
                         ("trustworthy", f"THE {int(trust.sum())} TRUSTWORTHY ONLY")):
        rows.sort(key=lambda x: -x[scope]["auc"])
        print("=" * 86)
        print(f"{title}   —   AUC = mean rank of the known sites (0.50 = chance)")
        print("=" * 86)
        hdr = (f"{'model':20}{'AUC':>7}{'p':>8}" +
               "".join(f"{'R@' + str(k) + '%':>8}" for k in KS) +
               f"{'median':>9}{'worst':>8}{'prec':>7}{'F1':>5}")
        print(hdr)
        for x in rows:
            m = x[scope]
            star = " *" if m["p"] < 0.05 else "  "
            print(f"{x['model']:20}{m['auc']:7.3f}{m['p']:7.4f}{star}" +
                  "".join(f"{m[f'recall@{k}%']:8.2f}" for k in KS) +
                  f"{m['median_rank']:9.3f}{m['worst_rank']:8.3f}"
                  f"{'—':>7}{'—':>5}")
        print()

    best = max(rows, key=lambda x: x["trustworthy"]["auc"])
    print("-" * 86)
    print(f"Best on the trustworthy coordinates: {best['model']}  "
          f"AUC {best['trustworthy']['auc']:.3f}  p {best['trustworthy']['p']:.4f}")
    print(f"  recall@10% = {best['trustworthy']['recall@10%']:.0%}  "
          f"({best['trustworthy']['hits@10%']} of {best['trustworthy']['n']} "
          f"known sites land in the worst 10% of the city)")
    print("\nprecision and F1 are '—' throughout because there are no confirmed")
    print("dry streets to count against. That is a property of the data, not of")
    print("the models, and no amount of modelling fixes it -- only fieldwork does.")

    OUT.write_text(json.dumps({"n_points": len(pts),
                               "n_trustworthy": int(trust.sum()),
                               "draws": DRAWS, "results": rows},
                              indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
