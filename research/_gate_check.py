"""Phase 0 gate: is the registry refactor faithful, or did it change results?

Runs leave-one-city-out twice — once with the ORIGINAL inline XGBClassifier
exactly as it was written before the refactor, once through models.build() —
and compares. If the two agree with each other but disagree with the published
results_multi.json, the refactor is exonerated and the drift is environmental.

    .venv/Scripts/python.exe _gate_check.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from cities import CITIES
from models import build
from train_multi import build_matrix

HERE = Path(__file__).parent


def original_model(y_train):
    """Verbatim copy of train_multi.model() as it stood before the refactor."""
    import xgboost as xgb
    return xgb.XGBClassifier(
        n_estimators=350, max_depth=5, learning_rate=0.06,
        subsample=0.85, colsample_bytree=0.85,
        scale_pos_weight=float((y_train == 0).sum() / max(y_train.sum(), 1)),
        eval_metric="aucpr", tree_method="hist", random_state=42, n_jobs=4)


def loco(data, make):
    out = {}
    for held in data:
        tr = [c for c in data if c != held]
        Xtr = np.vstack([data[c][0] for c in tr])
        ytr = np.concatenate([data[c][1] for c in tr])
        Xte, yte, _, _, _ = data[held]
        p = make(ytr).fit(Xtr, ytr).predict_proba(Xte)[:, 1]
        out[held] = {"pr_auc": float(average_precision_score(yte, p)),
                     "roc_auc": float(roc_auc_score(yte, p)),
                     "lift": float(average_precision_score(yte, p) / yte.mean())}
    return out


def main() -> None:
    data = {c: build_matrix(c) for c in CITIES if CITIES[c].get("labels_url")
            and (HERE / "cache" / c / "meta.json").exists()}

    print("\nrunning original inline definition ...")
    a = loco(data, original_model)
    print("running registry build('xgboost') ...")
    b = loco(data, lambda y: build("xgboost", y, seed=42))

    published = json.loads((HERE / "results_multi.json").read_text())["loco"]

    print(f"\n{'city':10} {'published':>10} {'inline':>10} {'registry':>10}   verdict")
    same_pair = True
    for city in a:
        pub = published[city]["pr_auc"]
        print(f"{city:10} {pub:10.5f} {a[city]['pr_auc']:10.5f} "
              f"{b[city]['pr_auc']:10.5f}", end="   ")
        if abs(a[city]["pr_auc"] - b[city]["pr_auc"]) > 1e-9:
            print("REFACTOR CHANGED RESULTS")
            same_pair = False
        elif abs(a[city]["pr_auc"] - pub) > 1e-4:
            print("env drift (refactor faithful)")
        else:
            print("exact match")

    print()
    if same_pair:
        print("Refactor is faithful: inline and registry agree to 1e-9.")
        print("Any gap against results_multi.json is environmental, not code.")
    else:
        print("STOP — the registry does not reproduce the inline model.")


if __name__ == "__main__":
    main()
