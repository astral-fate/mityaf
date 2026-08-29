# -*- coding: utf-8 -*-
"""Fit every candidate once, persist the weights, and never retrain to infer.

The bake-off fitted fourteen models, read their scores and threw the fitted
objects away, so every later question -- score Madinah, score a new district,
score next year's OSM extract -- meant paying the whole training cost again.
This fits them once and writes them to `models_store/`.

Each candidate gets two files:

    models_store/<name>.joblib   the fitted estimator
    models_store/<name>.json     the contract needed to use it safely --
                                 feature order, which columns were rank
                                 normalised, training cities, row and positive
                                 counts, library versions, fit seconds

The JSON matters as much as the weights. A pickled tree ensemble is a silent
trap: hand it columns in a different order and it returns confident nonsense
rather than an error. `load()` below checks the feature order against the
sidecar and refuses to run if they disagree.

    .venv/Scripts/python.exe train_and_save.py            # fit what is missing
    .venv/Scripts/python.exe train_and_save.py --force    # refit everything
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import sklearn

import models as M
from cities import CITIES
from domain_adapt import DEM, rank_norm
from train_multi import build_matrix

HERE = Path(__file__).parent
STORE = HERE / "models_store"
SEED = 42


def _versions() -> dict:
    v = {"python": sys.version.split()[0], "sklearn": sklearn.__version__,
         "numpy": np.__version__}
    for lib in ("xgboost", "lightgbm", "catboost"):
        try:
            v[lib] = __import__(lib).__version__
        except Exception:                                        # noqa: BLE001
            pass
    return v


def load(name: str):
    """Return (estimator, contract). Raises if the store is missing or stale."""
    est_p, meta_p = STORE / f"{name}.joblib", STORE / f"{name}.json"
    if not est_p.exists():
        raise FileNotFoundError(f"no saved weights for {name!r} — run train_and_save.py")
    return joblib.load(est_p), json.loads(meta_p.read_text(encoding="utf-8"))


def predict(name: str, X: np.ndarray, feature_order: list[str]) -> np.ndarray:
    """Score a matrix, refusing to run if the feature order does not match.

    Tree ensembles do not validate column order. Passing the same nine features
    in a different sequence produces plausible, wrong numbers and no warning.
    """
    est, meta = load(name)
    if list(feature_order) != meta["feature_order"]:
        raise ValueError(
            f"feature order mismatch for {name!r}.\n"
            f"  saved:  {meta['feature_order']}\n"
            f"  given:  {list(feature_order)}")
    return est.predict_proba(X)[:, 1]


def main() -> None:
    force = "--force" in sys.argv
    STORE.mkdir(exist_ok=True)

    us = [c for c in CITIES if c != "madinah" and CITIES[c].get("labels_url")
          and (HERE / "cache" / c / "meta.json").exists()]
    full = {c: build_matrix(c) for c in us}
    keys = list(full[us[0]][3])
    dem_cols = [i for i, k in enumerate(keys) if k in DEM]

    X = np.vstack([rank_norm(full[c][0], dem_cols) for c in us])
    y = np.concatenate([full[c][1] for c in us])
    print(f"\ntraining matrix: {X.shape[0]:,} rows x {X.shape[1]} features, "
          f"{int(y.sum()):,} positive ({y.mean():.1%})")
    print(f"feature order:   {keys}")
    print(f"rank-normalised: {[keys[i] for i in dem_cols]}\n")

    avail = [m for m, ok in M.available().items() if ok]
    done, skipped, failed = [], [], []
    for name in avail:
        if (STORE / f"{name}.joblib").exists() and not force:
            skipped.append(name)
            print(f"  {name:22} already saved")
            continue
        t0 = time.time()
        try:
            est = M.build(name, y, SEED)
            M.fit(est, X, y, name)
        except Exception as e:                                    # noqa: BLE001
            failed.append((name, f"{type(e).__name__}: {e}"))
            print(f"  {name:22} FAILED — {type(e).__name__}: {e}")
            continue
        dt = time.time() - t0
        joblib.dump(est, STORE / f"{name}.joblib", compress=3)
        (STORE / f"{name}.json").write_text(json.dumps({
            "name": name, "seed": SEED, "fit_seconds": round(dt, 1),
            "feature_order": keys, "rank_normalised": [keys[i] for i in dem_cols],
            "train_cities": us, "n_rows": int(X.shape[0]),
            "n_positive": int(y.sum()), "prevalence": float(y.mean()),
            "versions": _versions(),
        }, indent=1), encoding="utf-8")
        size = (STORE / f"{name}.joblib").stat().st_size / 1024
        done.append(name)
        print(f"  {name:22} saved  {dt:6.1f}s  {size:8.0f} KB")

    print(f"\n{len(done)} fitted, {len(skipped)} already present, {len(failed)} failed")
    if failed:
        for n, e in failed:
            print(f"   {n}: {e}")
    total = sum(f.stat().st_size for f in STORE.glob("*.joblib")) / 1024 / 1024
    print(f"store: {STORE}  ({len(list(STORE.glob('*.joblib')))} models, {total:.1f} MB)")


if __name__ == "__main__":
    main()
