"""Candidate models for the bake-off.

One registry, one construction seam. `train_multi.py` and `threshold_metrics.py`
both build through `build()`, so adding a candidate never means touching the
evaluation code -- which is what keeps the comparison honest.

Two things are equalised across every candidate, because otherwise the table
compares preprocessing choices rather than models:

*Class imbalance.* Prevalence is 27-36%, and the incumbent XGBoost uses
`scale_pos_weight`. Every candidate therefore gets the equivalent treatment in
whatever form its own library offers -- `scale_pos_weight`, `class_weight` or an
explicit `sample_weight` at fit time. `fit()` below routes each one correctly.

*Feature scaling.* Trees do not care; SVM, MLP, k-NN and logistic regression care
a great deal. Those candidates are wrapped in a Pipeline with StandardScaler so
they are not handicapped by the raw feature ranges (logacc and road_density
differ by orders of magnitude).

    from models import build, fit, REGISTRY
    est = build("random_forest", y_train, seed=42)
    fit(est, X_train, y_train)
"""
from __future__ import annotations

import numpy as np

N_JOBS = 4


def _pos_weight(y) -> float:
    """n_neg / n_pos — the exact quantity train_multi.py has always used."""
    y = np.asarray(y)
    return float((y == 0).sum() / max(y.sum(), 1))


def _scaled(estimator):
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    return Pipeline([("scale", StandardScaler()), ("clf", estimator)])


# ── candidates ─────────────────────────────────────────────────────────────
# Each builder takes (y_train, seed) and returns an unfitted estimator.

def _always_negative(y, seed):
    """The 72.6% accuracy trap, as an actual competitor.

    Scores every cell identically, so average precision collapses to the
    prevalence and lift is exactly 1.00x. It exists to make the point that
    accuracy can be high while the model is worthless.
    """
    from sklearn.dummy import DummyClassifier
    # "constant" not "prior": with prior, each CV fold emits its own training
    # prevalence, and those per-fold constants become a spurious ranking once
    # out-of-fold predictions are pooled — which scored the baseline at 0.90
    # lift instead of the 1.00 it must be by definition.
    return DummyClassifier(strategy="constant", constant=0)


def _logistic(l1_ratio):
    def build_fn(y, seed):
        # sklearn 1.8 deprecated `penalty`; l1_ratio 0 is ridge, 1 is lasso.
        from sklearn.linear_model import LogisticRegression
        return _scaled(LogisticRegression(
            l1_ratio=l1_ratio, C=1.0, solver="saga", max_iter=4000,
            class_weight="balanced", random_state=seed))
    return build_fn


def _decision_tree(y, seed):
    from sklearn.tree import DecisionTreeClassifier
    return DecisionTreeClassifier(
        max_depth=5, class_weight="balanced", random_state=seed)


def _random_forest(y, seed):
    from sklearn.ensemble import RandomForestClassifier
    return RandomForestClassifier(
        n_estimators=350, max_depth=None, min_samples_leaf=2,
        max_features="sqrt", class_weight="balanced_subsample",
        random_state=seed, n_jobs=N_JOBS)


def _extra_trees(y, seed):
    from sklearn.ensemble import ExtraTreesClassifier
    return ExtraTreesClassifier(
        n_estimators=350, max_depth=None, min_samples_leaf=2,
        max_features="sqrt", class_weight="balanced_subsample",
        random_state=seed, n_jobs=N_JOBS)


def _hist_gb(y, seed):
    # sklearn's own boosting. No class_weight before 1.3, so fit() supplies
    # sample_weight for this one instead.
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(
        max_iter=350, max_depth=5, learning_rate=0.06,
        random_state=seed)


def _xgboost(y, seed):
    """The incumbent. These hyperparameters are load-bearing: with seed=42 this
    must reproduce results_multi.json exactly, which is the Phase 0 gate."""
    import xgboost as xgb
    return xgb.XGBClassifier(
        n_estimators=350, max_depth=5, learning_rate=0.06,
        subsample=0.85, colsample_bytree=0.85,
        scale_pos_weight=_pos_weight(y),
        eval_metric="aucpr", tree_method="hist",
        random_state=seed, n_jobs=N_JOBS)


def _lightgbm(y, seed):
    from lightgbm import LGBMClassifier
    return LGBMClassifier(
        n_estimators=350, max_depth=5, learning_rate=0.06,
        subsample=0.85, subsample_freq=1, colsample_bytree=0.85,
        scale_pos_weight=_pos_weight(y),
        random_state=seed, n_jobs=N_JOBS, verbose=-1)


def _catboost(y, seed):
    from catboost import CatBoostClassifier
    return CatBoostClassifier(
        iterations=350, depth=5, learning_rate=0.06,
        scale_pos_weight=_pos_weight(y),
        random_seed=seed, verbose=0, thread_count=N_JOBS)


def _svm_rbf(y, seed):
    # O(n^2)+ in samples: 62k rows is impractical, so the runner subsamples for
    # this candidate and the table says so rather than quietly omitting it.
    from sklearn.svm import SVC
    return _scaled(SVC(
        C=1.0, gamma="scale", kernel="rbf", class_weight="balanced",
        probability=True, random_state=seed, cache_size=1000))


def _mlp(y, seed):
    # No class_weight and no sample_weight support in sklearn's MLP, so this
    # candidate runs unweighted. Flagged in the results rather than hidden --
    # if it underperforms, that is part of the reason.
    from sklearn.neural_network import MLPClassifier
    return _scaled(MLPClassifier(
        hidden_layer_sizes=(64, 32), activation="relu", alpha=1e-3,
        learning_rate_init=1e-3, max_iter=400, early_stopping=True,
        n_iter_no_change=15, random_state=seed))


def _naive_bayes(y, seed):
    from sklearn.naive_bayes import GaussianNB
    return GaussianNB()


def _knn(y, seed):
    from sklearn.neighbors import KNeighborsClassifier
    return _scaled(KNeighborsClassifier(
        n_neighbors=25, weights="distance", n_jobs=N_JOBS))


REGISTRY = {
    "always_negative": _always_negative,
    "logistic_l2": _logistic(0.0),
    "logistic_l1": _logistic(1.0),
    "decision_tree": _decision_tree,
    "random_forest": _random_forest,
    "extra_trees": _extra_trees,
    "hist_gb": _hist_gb,
    "xgboost": _xgboost,
    "lightgbm": _lightgbm,
    "catboost": _catboost,
    "svm_rbf": _svm_rbf,
    "mlp": _mlp,
    "naive_bayes": _naive_bayes,
    "knn": _knn,
}

# Candidates whose library has no class-weight parameter: fit() passes an
# explicit sample_weight instead so they are not handicapped.
NEEDS_SAMPLE_WEIGHT = {"hist_gb"}

# Candidates too slow for the full 62k-row matrix; the runner subsamples and
# records that it did.
SUBSAMPLE = {"svm_rbf": 12_000, "knn": 40_000}

# Candidates that cannot be weighted at all — reported with a caveat.
UNWEIGHTED = {"mlp", "naive_bayes", "knn", "always_negative"}


def build(name: str, y_train, seed: int = 42):
    if name not in REGISTRY:
        raise KeyError(f"unknown model {name!r}; known: {sorted(REGISTRY)}")
    return REGISTRY[name](y_train, seed)


def fit(estimator, X, y, name: str | None = None):
    """Fit, supplying sample_weight only where the estimator needs it."""
    if name in NEEDS_SAMPLE_WEIGHT:
        w = np.where(np.asarray(y) == 1, _pos_weight(y), 1.0)
        return estimator.fit(X, y, sample_weight=w)
    return estimator.fit(X, y)


def available() -> dict[str, bool]:
    """Which candidates can actually run here — optional deps may be missing."""
    out = {}
    for name in REGISTRY:
        try:
            build(name, np.array([0, 1, 0, 1], dtype="int8"), 42)
            out[name] = True
        except Exception:
            out[name] = False
    return out
