"""Accuracy, precision, recall and F1 — the metrics PR-AUC deliberately omits.

PR-AUC is threshold-free; accuracy, recall and F1 are not. Every number here
therefore comes with the cutoff that produced it, because quoting one without
the other is meaningless.

Reproduces the exact evaluation in train_multi.py -- same features, same
GroupKFold spatial blocks, same hyperparameters -- and collects out-of-fold
predictions instead of only the summary score.

    python research/threshold_metrics.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from cities import CITIES
from train_multi import build_matrix, model

HERE = Path(__file__).parent
OUT = HERE / "threshold_metrics.json"


def at(y, p, thr):
    """Confusion-matrix metrics at one cutoff."""
    yhat = (p >= thr).astype(int)
    tp = int(((yhat == 1) & (y == 1)).sum())
    fp = int(((yhat == 1) & (y == 0)).sum())
    fn = int(((yhat == 0) & (y == 1)).sum())
    tn = int(((yhat == 0) & (y == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"threshold": float(thr), "accuracy": (tp + tn) / len(y),
            "precision": prec, "recall": rec, "f1": f1,
            "tp": tp, "fp": fp, "fn": fn, "tn": tn}


def best_f1(y, p):
    grid = np.quantile(p, np.linspace(0.01, 0.99, 197))
    return max((at(y, p, t) for t in np.unique(grid)), key=lambda r: r["f1"])


def precision_at_k(y, p, ks=(100, 500, 1000, 2000)):
    """Of the top-K cells the model ranks riskiest, how many actually flooded?

    This is the metric that matches how the platform is used: nobody applies a
    threshold to 30,337 segments, they work down a ranked list until the budget
    runs out. Read it against prevalence -- that is the hit rate of inspecting
    at random.
    """
    order = np.argsort(-p)
    return {str(k): float(y[order[:k]].mean()) for k in ks if k <= len(y)}


def report(tag, y, p, out):
    base = float(y.mean())
    # the accuracy a model earns by predicting "never floods" for every cell
    trivial = 1.0 - base
    half = at(y, p, 0.5)
    best = best_f1(y, p)
    patk = precision_at_k(y, p)
    out[tag] = {"n": int(len(y)), "prevalence": base,
                "always_negative_accuracy": trivial,
                "at_0.5": half, "best_f1": best, "precision_at_k": patk}
    print(f"\n{tag}   n={len(y):,}   prevalence={base:.3f}")
    print(f"  'always no flood' accuracy .... {trivial:.3f}   <- the misleading number")
    for label, r in (("threshold 0.50", half), (f"best-F1 thr {best['threshold']:.3f}", best)):
        print(f"  {label:<22} acc {r['accuracy']:.3f}  prec {r['precision']:.3f}  "
              f"rec {r['recall']:.3f}  F1 {r['f1']:.3f}")
    hits = "  ".join(f"top-{k}: {100 * v:.1f}%" for k, v in patk.items())
    print(f"  ranked-list hit rate .. {hits}")
    print(f"  (random inspection would hit {100 * base:.1f}%)")
    return out


def main() -> None:
    from sklearn.model_selection import GroupKFold

    data = {}
    for city in CITIES:
        if not CITIES[city].get("labels_url"):
            continue
        if not (HERE / "cache" / city / "meta.json").exists():
            print(f"  {city}: no cache — run build_city.py {city}")
            continue
        data[city] = build_matrix(city)

    if len(data) < 2:
        raise SystemExit("need at least two labelled cities")

    out: dict = {}

    # ── within city, spatial block CV: collect out-of-fold predictions ──────
    for city, (X, y, block, _, meta) in data.items():
        oof = np.full(len(y), np.nan)
        for tr, te in GroupKFold(n_splits=5).split(X, y, block):
            if y[te].sum() < 5:
                continue
            m = model(y[tr]).fit(X[tr], y[tr])
            oof[te] = m.predict_proba(X[te])[:, 1]
        ok = ~np.isnan(oof)
        report(f"{meta['name']} — within-city, spatial CV", y[ok], oof[ok], out)

    # ── leave one city out ─────────────────────────────────────────────────
    for held in data:
        tr_cities = [c for c in data if c != held]
        Xtr = np.vstack([data[c][0] for c in tr_cities])
        ytr = np.concatenate([data[c][1] for c in tr_cities])
        Xte, yte, _, _, meta = data[held]
        m = model(ytr).fit(Xtr, ytr)
        p = m.predict_proba(Xte)[:, 1]
        report(f"{'+'.join(tr_cities)} -> {meta['name']} (unseen city)", yte, p, out)

    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
