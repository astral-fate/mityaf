"""Phase 1 — compare every candidate model under identical spatial CV.

The primary endpoint, declared before running: **mean cross-city PR-AUC lift**
from leave-one-city-out. That measures the claim Mityaf actually makes — that
the model form transfers to a city it was never fitted on — rather than how
well a model memorises a city it has already seen. Within-city scores and
precision@K are reported as secondary.

Every model sees the identical feature matrix, the identical GroupKFold spatial
blocks and the identical seeds. Only the estimator changes, so any difference is
attributable to the model.

Results checkpoint to results_models.json after each model, so the run is
resumable and can be inspected while it is still going.

    .venv/Scripts/python.exe bakeoff.py                 # everything
    .venv/Scripts/python.exe bakeoff.py --models xgboost,random_forest
    .venv/Scripts/python.exe bakeoff.py --seeds 42      # one seed, quick look
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupKFold

import models as M
from cities import CITIES
from threshold_metrics import at, best_f1, precision_at_k
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_models.json"
SEEDS = [42, 1, 7, 2024, 31337]

# Given the same data these fit identically whatever the seed, so one run is
# the whole story and four more would just burn an hour.
DETERMINISTIC = {"always_negative", "logistic_l2", "logistic_l1",
                 "decision_tree", "naive_bayes", "knn"}


def evaluate(y, p) -> dict:
    base = float(y.mean())
    ap = float(average_precision_score(y, p))
    half, best = at(y, p, 0.5), best_f1(y, p)
    # Lift is bounded by 1/prevalence, so it is not comparable across cities
    # whose prevalence differs 13-fold (Dallas 5.4%, San Francisco 69.1%). At
    # 69% the ceiling is 1.45x, so San Francisco cannot score what New York can
    # however good the model is. Skill is the fraction of the available headroom
    # actually captured -- 0 is random, 1 is perfect -- and it is comparable.
    return {
        "pr_auc": ap, "prevalence": base, "lift": ap / base,
        "lift_ceiling": 1.0 / base,
        "skill": (ap - base) / (1.0 - base),
        "roc_auc": float(roc_auc_score(y, p)),
        "accuracy_0.5": half["accuracy"], "precision_0.5": half["precision"],
        "recall_0.5": half["recall"], "f1_0.5": half["f1"],
        "best_f1": best["f1"], "best_f1_threshold": best["threshold"],
        "best_f1_recall": best["recall"], "best_f1_precision": best["precision"],
        "precision_at_k": precision_at_k(y, p),
        "always_negative_accuracy": 1.0 - base,
    }


def subsample(X, y, cap, seed):
    """Cap training size for candidates that cannot take 62k rows.

    Stratified so prevalence is preserved — otherwise the model is handicapped
    by a different class balance rather than by its own limitations.
    """
    if cap is None or len(y) <= cap:
        return X, y
    rng = np.random.default_rng(seed)
    pos, neg = np.where(y == 1)[0], np.where(y == 0)[0]
    n_pos = int(round(cap * y.mean()))
    idx = np.concatenate([rng.choice(pos, min(n_pos, len(pos)), replace=False),
                          rng.choice(neg, min(cap - n_pos, len(neg)), replace=False)])
    rng.shuffle(idx)
    return X[idx], y[idx]


def run_model(name, data, seed) -> dict:
    cap = M.SUBSAMPLE.get(name)
    out = {"within": {}, "loco": {}}

    for city, (X, y, block, _, meta) in data.items():
        oof = np.full(len(y), np.nan)
        for tr, te in GroupKFold(n_splits=5).split(X, y, block):
            if y[te].sum() < 5:
                continue
            Xtr, ytr = subsample(X[tr], y[tr], cap, seed)
            est = M.build(name, ytr, seed)
            M.fit(est, Xtr, ytr, name)
            oof[te] = est.predict_proba(X[te])[:, 1]
        ok = ~np.isnan(oof)
        out["within"][city] = evaluate(y[ok], oof[ok])

    for held in data:
        tr_cities = [c for c in data if c != held]
        Xtr = np.vstack([data[c][0] for c in tr_cities])
        ytr = np.concatenate([data[c][1] for c in tr_cities])
        Xte, yte, _, _, _ = data[held]
        Xtr, ytr = subsample(Xtr, ytr, cap, seed)
        est = M.build(name, ytr, seed)
        M.fit(est, Xtr, ytr, name)
        out["loco"][held] = evaluate(yte, est.predict_proba(Xte)[:, 1])

    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="")
    ap.add_argument("--seeds", default="")
    args = ap.parse_args()

    wanted = ([m.strip() for m in args.models.split(",") if m.strip()]
              or list(M.REGISTRY))
    seeds = ([int(s) for s in args.seeds.split(",") if s.strip()] or SEEDS)

    avail = M.available()
    skip = [m for m in wanted if not avail.get(m)]
    wanted = [m for m in wanted if avail.get(m)]
    if skip:
        print(f"skipping (missing dependency): {', '.join(skip)}")

    data = {c: build_matrix(c) for c in CITIES if CITIES[c].get("labels_url")
            and (HERE / "cache" / c / "meta.json").exists()}
    print(f"\nprimary endpoint: mean cross-city PR-AUC lift "
          f"({len(data)} cities, leave-one-out)\n")

    results = json.loads(OUT.read_text()) if OUT.exists() else {}

    for name in wanted:
        use = [seeds[0]] if name in DETERMINISTIC else seeds
        results.setdefault(name, {})
        for seed in use:
            if str(seed) in results[name]:
                continue
            t0 = time.time()
            try:
                results[name][str(seed)] = run_model(name, data, seed)
            except Exception as e:                             # noqa: BLE001
                print(f"  {name:16} seed {seed:<6} FAILED  {str(e)[:60]}")
                results[name][str(seed)] = {"error": str(e)[:200]}
                continue
            results[name][str(seed)]["seconds"] = round(time.time() - t0, 1)
            OUT.write_text(json.dumps(results, indent=1))

            r = results[name][str(seed)]
            lifts = [v["lift"] for v in r["loco"].values()]
            print(f"  {name:16} seed {seed:<6} cross-city lift "
                  f"{np.mean(lifts):.3f}   ({time.time() - t0:.0f}s)")

    OUT.write_text(json.dumps(results, indent=1))
    print(f"\nwrote {OUT.name}")

    # ── leaderboard, ranked on cross-city skill ────────────────────────────
    # Skill leads, not lift: with prevalence spanning 5.4% to 69.1%, mean lift
    # rewards whichever cities happen to have low prevalence rather than
    # whichever model is better.
    print(f"\n{'model':17}{'x-city skill':>14}{'x-city lift':>13}"
          f"{'within skill':>14}{'F1':>7}{'recall':>8}{'P@100':>7}")
    board = []
    for name, seeds_d in results.items():
        runs = [r for r in seeds_d.values() if "loco" in r]
        if not runs:
            continue

        def mean_over(key, blk, rs=runs):
            return [np.mean([v[key] for v in r[blk].values()]) for r in rs]

        s = mean_over("skill", "loco")
        board.append((
            np.mean(s), np.std(s), name,
            np.mean(mean_over("lift", "loco")),
            np.mean(mean_over("skill", "within")),
            np.mean(mean_over("best_f1", "loco")),
            np.mean(mean_over("best_f1_recall", "loco")),
            np.mean([np.mean([list(v["precision_at_k"].values())[0]
                              for v in r["loco"].values()]) for r in runs]),
        ))
    for sm, ss, name, lm, ws, f1, rc, pk in sorted(board, reverse=True):
        sd = f"+/-{ss:.3f}" if ss else "        "
        print(f"  {name:15}{sm:7.4f} {sd}{lm:13.3f}{ws:14.4f}"
              f"{f1:7.3f}{rc:8.3f}{pk:7.3f}")


if __name__ == "__main__":
    main()
