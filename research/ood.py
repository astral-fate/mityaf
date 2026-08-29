"""Phase 6 — is Al Madinah inside the distribution the model was trained on?

The product scores 30,337 Madinah street segments with a model fitted on US
cities. That is only defensible if Madinah resembles those cities in feature
space, and nothing so far has checked whether it does.

The design here is what makes this evidence rather than assertion. We already
know, per city, how badly the model transfers -- leave-one-city-out skill runs
from +0.297 in San Francisco down to +0.024 in Dallas. So we can ask whether a
distance measure computed *without any labels* predicts that degradation. If it
does across the four labelled cities, the same measure applied to Madinah is
calibrated rather than hopeful.

Three measures, all label-free:

  Mahalanobis  distance to the training mean, scaled by the training covariance
               -- catches a city sitting off the joint distribution even when
               every single feature looks individually normal.
  Isolation Forest  novelty score against the training set, which unlike
               Mahalanobis makes no assumption that the cloud is ellipsoidal.
  PSI          population stability index, per feature. The only one of the
               three that names *which* feature has drifted, which is what makes
               it actionable rather than merely diagnostic.

    .venv/Scripts/python.exe ood.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from cities import CITIES
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_ood.json"

# PSI convention from the credit-scoring literature, where it originates.
PSI_BANDS = [(0.10, "stable"), (0.25, "moderate shift"), (float("inf"), "major shift")]


def mahalanobis(train: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Squared Mahalanobis distance of each target row to the training cloud."""
    mu = train.mean(axis=0)
    cov = np.cov(train, rowvar=False)
    # Ridge: several features are near-collinear (logacc feeds load_per_road),
    # so the raw covariance is ill-conditioned and its inverse explodes.
    cov += np.eye(cov.shape[0]) * 1e-6 * np.trace(cov) / cov.shape[0]
    inv = np.linalg.pinv(cov)
    d = target - mu
    return np.einsum("ij,jk,ik->i", d, inv, d)


def psi(train: np.ndarray, target: np.ndarray, bins: int = 10) -> float:
    """Population stability index for one feature, on training deciles."""
    edges = np.unique(np.quantile(train, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return 0.0
    edges[0], edges[-1] = -np.inf, np.inf
    a = np.histogram(train, bins=edges)[0].astype(float)
    b = np.histogram(target, bins=edges)[0].astype(float)
    a, b = a / max(a.sum(), 1), b / max(b.sum(), 1)
    eps = 1e-6                      # empty bins would otherwise give infinite PSI
    a, b = np.clip(a, eps, None), np.clip(b, eps, None)
    return float(np.sum((b - a) * np.log(b / a)))


def isolation_score(train: np.ndarray, target: np.ndarray, seed: int = 42):
    """Mean novelty of the target under a forest grown on the training set.

    Returned sign-flipped so that larger means more anomalous, matching the
    direction of the other two measures.
    """
    from sklearn.ensemble import IsolationForest
    rng = np.random.default_rng(seed)
    sub = train[rng.choice(len(train), min(40_000, len(train)), replace=False)]
    iso = IsolationForest(n_estimators=300, random_state=seed, n_jobs=4).fit(sub)
    return -iso.score_samples(target)


def band(p: float) -> str:
    return next(lab for lim, lab in PSI_BANDS if p < lim)


def main() -> None:
    labelled = [c for c in CITIES if CITIES[c].get("labels_url")
                and (HERE / "cache" / c / "meta.json").exists()]
    data = {c: build_matrix(c) for c in labelled}
    keys = next(iter(data.values()))[3]

    has_madinah = (HERE / "cache" / "madinah" / "meta.json").exists()
    if has_madinah:
        mad = build_matrix("madinah")
        data_mad, keys_mad = mad[0], mad[3]
        assert keys_mad == keys, "feature order differs between cities"

    # observed transfer skill per city, from the winning model
    try:
        res = json.loads((HERE / "results_models.json").read_text())
        runs = [r for r in res["catboost"].values() if "loco" in r]
        observed = {c: float(np.mean([r["loco"][c]["skill"] for r in runs]))
                    for c in labelled}
    except Exception:                                          # noqa: BLE001
        observed = {}

    out = {"cities": {}, "madinah": {}}

    # ── does distance predict transfer degradation? ────────────────────────
    print("\nleave-one-city-out: distance from the training pool vs measured skill\n")
    print(f"{'held-out':10}{'mahalanobis':>14}{'iso-forest':>12}{'mean PSI':>10}"
          f"{'worst feature':>18}{'observed skill':>16}")
    rows = []
    for held in labelled:
        tr = np.vstack([data[c][0] for c in labelled if c != held])
        te = data[held][0]
        m = float(np.median(mahalanobis(tr, te)))
        iso = float(np.mean(isolation_score(tr, te)))
        per_feat = {k: psi(tr[:, i], te[:, i]) for i, k in enumerate(keys)}
        worst = max(per_feat, key=per_feat.get)
        mp = float(np.mean(list(per_feat.values())))
        sk = observed.get(held, float("nan"))
        rows.append((held, m, iso, mp, sk))
        out["cities"][held] = {"mahalanobis_median": m, "iso_mean": iso,
                               "psi_mean": mp, "psi_per_feature": per_feat,
                               "psi_worst": worst, "observed_skill": sk}
        print(f"{held:10}{m:14.2f}{iso:12.4f}{mp:10.3f}{worst:>18}{sk:16.4f}")

    if len(rows) >= 3 and not any(np.isnan(r[4]) for r in rows):
        from scipy.stats import pearsonr
        sk = [r[4] for r in rows]
        for name, idx in (("mahalanobis", 1), ("iso-forest", 2), ("PSI", 3)):
            r, p = pearsonr([x[idx] for x in rows], sk)
            out.setdefault("validation", {})[name] = {"pearson_r": float(r),
                                                      "p_value": float(p)}
            print(f"  {name:12} vs skill:  r = {r:+.3f}   p = {p:.3f}"
                  f"   ({'predicts degradation' if r < -0.5 else 'weak'})")

    # ── where does Madinah sit? ────────────────────────────────────────────
    if has_madinah:
        tr = np.vstack([data[c][0] for c in labelled])
        dist = mahalanobis(tr, data_mad)
        iso = isolation_score(tr, data_mad)
        per_feat = {k: psi(tr[:, i], data_mad[:, i]) for i, k in enumerate(keys)}

        # A cell is flagged if it is more extreme than 99% of the training data,
        # which is a statement about coverage, not about flood risk.
        thresh = float(np.quantile(mahalanobis(tr, tr), 0.99))
        flagged = float((dist > thresh).mean())

        out["madinah"] = {
            "n_cells": int(len(dist)),
            "mahalanobis_median": float(np.median(dist)),
            "mahalanobis_p90": float(np.quantile(dist, 0.90)),
            "iso_mean": float(np.mean(iso)),
            "psi_mean": float(np.mean(list(per_feat.values()))),
            "psi_per_feature": per_feat,
            "train_p99_threshold": thresh,
            "fraction_outside_train_p99": flagged,
        }
        print(f"\nAl Madinah — {len(dist):,} cells, against all "
              f"{len(labelled)} labelled cities")
        print(f"  mahalanobis median      {np.median(dist):.2f}   "
              f"(training 99th pct = {thresh:.2f})")
        print(f"  cells beyond that       {100 * flagged:.1f}%")
        print(f"  iso-forest mean         {np.mean(iso):.4f}")
        print(f"  mean PSI                {np.mean(list(per_feat.values())):.3f}"
              f"   -> {band(np.mean(list(per_feat.values())))}")
        print("\n  per-feature drift:")
        for k, v in sorted(per_feat.items(), key=lambda kv: -kv[1]):
            print(f"    {k:16}{v:7.3f}   {band(v)}")

    OUT.write_text(json.dumps(out, indent=1))
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
