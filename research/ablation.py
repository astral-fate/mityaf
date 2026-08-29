"""Phase 4 — which of the nine features actually carry the transfer?

Gain importance says what a model *used* on the data it was fitted to. It does
not say what would be lost without a feature, and it says nothing at all about
transfer. This drops each feature in turn and re-measures leave-one-city-out
skill, which is the only thing that answers "does Madinah need this column".

Also fits the two natural blocks -- the six DEM-derived terrain features alone,
and the three OpenStreetMap urban-form features alone -- because the headline
claim from MODEL-CARD.md is that urban form dominates, and a block ablation
tests that claim directly rather than through gain.

Evaluated on leave-one-city-out only. Within-city scores would double the
runtime to answer a question nobody asked.

    .venv/Scripts/python.exe ablation.py
    .venv/Scripts/python.exe ablation.py --model xgboost --seeds 42,1,7
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score

import models as M
from cities import CITIES
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_ablation.json"

DEM_FEATURES = {"slope", "sink", "logacc", "twi", "hand", "relelev"}
OSM_FEATURES = {"road_density", "major_frac", "load_per_road"}


def loco_skill(data, cols, name, seed) -> dict:
    """Mean and per-city leave-one-city-out skill using only `cols`."""
    per = {}
    for held in data:
        tr = [c for c in data if c != held]
        Xtr = np.vstack([data[c][0][:, cols] for c in tr])
        ytr = np.concatenate([data[c][1] for c in tr])
        Xte, yte = data[held][0][:, cols], data[held][1]
        est = M.build(name, ytr, seed)
        M.fit(est, Xtr, ytr, name)
        p = est.predict_proba(Xte)[:, 1]
        ap, base = float(average_precision_score(yte, p)), float(yte.mean())
        per[held] = (ap - base) / (1.0 - base)
    return {"per_city": per, "mean": float(np.mean(list(per.values())))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="catboost")
    ap.add_argument("--seeds", default="42,1,7")
    args = ap.parse_args()
    seeds = [int(s) for s in args.seeds.split(",")]

    data = {c: build_matrix(c) for c in CITIES if CITIES[c].get("labels_url")
            and (HERE / "cache" / c / "meta.json").exists()}
    keys = next(iter(data.values()))[3]
    idx = {k: i for i, k in enumerate(keys)}
    allc = list(range(len(keys)))

    configs = [("all nine", allc)]
    configs += [(f"drop {k}", [i for i in allc if i != idx[k]]) for k in keys]
    configs += [
        ("DEM block only", [idx[k] for k in keys if k in DEM_FEATURES]),
        ("OSM block only", [idx[k] for k in keys if k in OSM_FEATURES]),
    ]

    print(f"\nfeature ablation — {args.model}, {len(data)} cities, "
          f"{len(seeds)} seeds, leave-one-city-out\n")
    results, base_mean = {}, None
    for label, cols in configs:
        t0 = time.time()
        runs = [loco_skill(data, cols, args.model, s) for s in seeds]
        mean = float(np.mean([r["mean"] for r in runs]))
        sd = float(np.std([r["mean"] for r in runs]))
        if base_mean is None:
            base_mean = mean
        delta = mean - base_mean
        results[label] = {"mean_skill": mean, "sd": sd, "delta": delta,
                          "n_features": len(cols),
                          "per_city": {c: float(np.mean([r["per_city"][c] for r in runs]))
                                       for c in data}}
        flag = "" if label == "all nine" else f"{delta:+.4f}"
        print(f"  {label:20} n={len(cols)}  skill {mean:.4f} ±{sd:.4f}  {flag}"
              f"   ({time.time() - t0:.0f}s)")

    OUT.write_text(json.dumps({"model": args.model, "seeds": seeds,
                               "results": results}, indent=1))

    print("\nranked by damage done when removed (most damaging first)\n")
    drops = [(v["delta"], k.replace("drop ", "")) for k, v in results.items()
             if k.startswith("drop ")]
    for d, k in sorted(drops):
        bar = "#" * max(0, int(round(-d * 400)))
        print(f"  {k:16}{d:+.4f}  {bar}")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
