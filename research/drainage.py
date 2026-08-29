"""Phase 5 — is drainage failure a different phenomenon from terrain ponding?

The pipeline uses one NYC descriptor, "Street Flooding (SJ)", and leaves 50,821
labels sitting unused in the same feed: Catch Basin Clogged/Flooding (44,571)
and Manhole Overflow (6,250). Those are not terrain ponding. They are the case
where drainage exists and underperforms -- which is a different municipal
action. Terrain ponding wants the street added to a drainage plan; a clogged
catch basin wants a crew sent to clean it.

The question is whether the nine features can tell them apart at all. If a model
fitted on one target ranks the other just as well, they are the same signal
wearing two labels and the second head is pointless. If it cannot, the platform
can separate "this floods because of where it sits" from "this floods because
the drain is blocked" -- and that distinction is the recommendation engine.

Everything is held constant except the label: same grid, same terrain, same
roads, same spatial blocks.

    .venv/Scripts/python.exe drainage.py
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score
from sklearn.model_selection import GroupKFold

import models as M
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_drainage.json"
CACHE = HERE / "cache" / "nyc" / "drainage_points.npy"
SEEDS = [42, 1, 7]
MODEL = "catboost"

DRAIN_URL = (
    "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
    "?$select=created_date,descriptor,latitude,longitude"
    "&$where=descriptor in("
    "'Catch Basin Clogged/Flooding (Use Comments) (SC)',"
    "'Manhole Overflow (Use Comments) (SA1)') AND latitude IS NOT NULL"
    "&$limit=60000"
)


def drainage_points() -> np.ndarray:
    if CACHE.exists():
        return np.load(CACHE)
    print("  fetching NYC drainage-failure complaints ...")
    req = urllib.request.Request(
        DRAIN_URL.replace(" ", "%20"),
        headers={"User-Agent": "Mityaf-research/1.0 (urban flood validation)"})
    rows = json.load(urllib.request.urlopen(req, timeout=300))
    pts = np.array([[float(r["longitude"]), float(r["latitude"])] for r in rows
                    if r.get("latitude") and r.get("longitude")])
    np.save(CACHE, pts)
    return pts


def skill(y, p) -> float:
    ap, b = float(average_precision_score(y, p)), float(y.mean())
    return (ap - b) / (1.0 - b)


def oof(X, y, block, seed):
    out = np.full(len(y), np.nan)
    for tr, te in GroupKFold(n_splits=5).split(X, y, block):
        if y[te].sum() < 5:
            continue
        est = M.build(MODEL, y[tr], seed)
        M.fit(est, X[tr], y[tr], MODEL)
        out[te] = est.predict_proba(X[te])[:, 1]
    return out


def importances(X, y, seed, keys):
    est = M.build(MODEL, y, seed)
    M.fit(est, X, y, MODEL)
    imp = np.asarray(est.get_feature_importance())
    return {k: float(100 * v / imp.sum()) for k, v in zip(keys, imp)}


def main() -> None:
    pond = build_matrix("nyc")
    keys, block = pond[3], pond[2]
    X, y_pond = pond[0], pond[1]

    drain = build_matrix("nyc", points_override=drainage_points())
    y_drain = drain[1]
    assert np.array_equal(drain[0], X), "grid changed between targets"

    both = int(((y_pond == 1) & (y_drain == 1)).sum())
    print(f"\n  ponding cells   {int(y_pond.sum()):,} / {len(y_pond):,} "
          f"({y_pond.mean():.1%})")
    print(f"  drainage cells  {int(y_drain.sum()):,} / {len(y_drain):,} "
          f"({y_drain.mean():.1%})")
    print(f"  overlap         {both:,} cells "
          f"({100 * both / max(y_pond.sum(), 1):.1f}% of ponding cells)")

    out = {"counts": {"ponding": int(y_pond.sum()), "drainage": int(y_drain.sum()),
                      "overlap": both, "cells": int(len(y_pond))}}

    # ── how well is each target predicted, and can each predict the other? ──
    print("\n  within-NYC spatial CV, and cross-target transfer\n")
    print(f"  {'trained on':12}{'-> ponding':>14}{'-> drainage':>14}")
    scores = {}
    for tgt_name, y_tgt in (("ponding", y_pond), ("drainage", y_drain)):
        preds = [oof(X, y_tgt, block, s) for s in SEEDS]
        row = {}
        for eval_name, y_eval in (("ponding", y_pond), ("drainage", y_drain)):
            vals = []
            for p in preds:
                ok = ~np.isnan(p)
                vals.append(skill(y_eval[ok], p[ok]))
            row[eval_name] = float(np.mean(vals))
        scores[tgt_name] = row
        print(f"  {tgt_name:12}{row['ponding']:14.4f}{row['drainage']:14.4f}")
    out["cross_target_skill"] = scores

    # ── do the two targets weight the features differently? ────────────────
    ip = importances(X, y_pond, 42, keys)
    idr = importances(X, y_drain, 42, keys)
    out["importance"] = {"ponding": ip, "drainage": idr}
    print(f"\n  feature importance, same cells, different label\n")
    print(f"  {'feature':16}{'ponding':>10}{'drainage':>11}{'shift':>9}")
    for k in sorted(ip, key=lambda k: -abs(idr[k] - ip[k])):
        print(f"  {k:16}{ip[k]:9.1f}%{idr[k]:10.1f}%{idr[k] - ip[k]:+9.1f}")

    d = scores
    own = (d["ponding"]["ponding"] + d["drainage"]["drainage"]) / 2
    cross = (d["ponding"]["drainage"] + d["drainage"]["ponding"]) / 2
    print(f"\n  same-target mean  {own:.4f}")
    print(f"  cross-target mean {cross:.4f}   ({100 * cross / own:.0f}% retained)")
    out["separability"] = {"same_target": own, "cross_target": cross,
                           "retained": cross / own if own else None}

    OUT.write_text(json.dumps(out, indent=1))
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
