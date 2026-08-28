# -*- coding: utf-8 -*-
"""Score every Madinah street segment for water-accumulation susceptibility.

The model was trained on 101,756 geolocated street-flooding reports from New
York and Chicago, and the leave-one-city-out test is what licenses using it
here: trained on one city and tested on a city it had never seen, it stayed
1.24x and 1.30x above the prevalence baseline. That is the entire basis for
running it over Madinah, and it is a transfer claim, not a validated-in-Madinah
claim.

Two consequences follow, and both are encoded rather than written in a caption:

  * The output is a RANK, not a probability. Rainfall regime and drainage
    standards differ between Chicago and Madinah, so the absolute number is not
    calibrated here even though the ordering transfers. Every consumer sees a
    percentile band.
  * Every segment carries its own top drivers, taken from the model's per-
    feature contributions. An engineer has to be able to disagree with a score,
    and cannot disagree with a bare number.

    python research/score_madinah.py
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

HERE = Path(__file__).parent.resolve()
MODEL = HERE / "model_pooled.joblib"
FEATURES_CSV = HERE / "out" / "madinah_segments_features.csv"
OUT_CSV = HERE / "out" / "madinah_segment_risk.csv"

# Arabic names for the drivers, so the dashboard never has to map them itself.
DRIVER_AR = {
    "twi": "مؤشّر الرطوبة الطبوغرافي",
    "hand": "الارتفاع فوق أقرب مجرى",
    "sink": "عمق المنخفض المغلق",
    "slope": "الانحدار",
    "logacc": "تراكم الجريان الوارد",
    "relelev": "الارتفاع النسبي عن الجوار",
    "road_density": "كثافة الطرق",
    "major_frac": "نسبة الطرق الرئيسية",
    "load_per_road": "الحمل المائي لكل متر طريق",
}

# Percentile cuts. Deliberately top-heavy: a work list nobody can execute is
# the same as no work list, and 5% of 30,337 segments is already 1,500 streets.
BANDS = [
    (0.95, "critical", "حرج"),
    (0.80, "high", "مرتفع"),
    (0.50, "moderate", "متوسط"),
    (0.00, "stable", "مستقر"),
]

ACTION_AR = {
    "critical": "إدراج في خطة التصريف: فحص ميداني قبل الموسم المطري القادم",
    "high": "تفقّد المصارف السطحية وتنظيفها قبل الموسم",
    "moderate": "متابعة دورية — لا إجراء عاجل",
    "stable": "لا إجراء",
}


def rationale(row, drivers) -> str:
    """One sentence a person can argue with, built from this segment's drivers."""
    if not drivers:
        return "لا محرّك مهيمن — الدرجة ناتجة عن تجميع عوامل متقاربة"
    parts = []
    for name, contrib in drivers[:2]:
        ar = DRIVER_AR.get(name, name)
        direction = "يرفع" if contrib > 0 else "يخفض"
        parts.append(f"{ar} {direction} القابلية")
    return " · ".join(parts)


def main() -> None:
    bundle = joblib.load(MODEL)
    model = bundle["model"]
    feats = bundle["features"]

    df = pd.read_csv(FEATURES_CSV)
    df.columns = [c.lstrip("﻿") for c in df.columns]
    missing = [f for f in feats if f not in df.columns]
    if missing:
        raise SystemExit(f"features missing from the CSV: {missing}")

    X = df[feats].astype(float)
    # Median-fill rather than drop: a segment with one missing terrain value is
    # still a street the Amanah owns, and silently losing it from the register
    # would be worse than scoring it with a slightly weaker feature vector.
    n_filled = int(X.isna().any(axis=1).sum())
    X = X.fillna(X.median(numeric_only=True))

    proba = model.predict_proba(X)[:, 1]
    df["risk_raw"] = proba
    df["risk_pct"] = pd.Series(proba).rank(pct=True).to_numpy()

    band_key, band_ar = [], []
    for p in df["risk_pct"]:
        for cut, key, ar in BANDS:
            if p >= cut:
                band_key.append(key)
                band_ar.append(ar)
                break
    df["risk_band"] = band_key
    df["risk_band_ar"] = band_ar
    df["risk_rank"] = pd.Series(-proba).rank(method="min").astype(int)

    # Per-feature contributions straight from the booster: the last column is
    # the bias term, which is not a driver of anything.
    import xgboost as xgb
    contribs = model.get_booster().predict(
        xgb.DMatrix(X, feature_names=feats), pred_contribs=True)[:, :-1]

    tops, rats = [], []
    for i in range(len(df)):
        order = np.argsort(-np.abs(contribs[i]))[:3]
        drivers = [(feats[j], float(contribs[i][j])) for j in order]
        tops.append(json.dumps(
            [{"f": n, "ar": DRIVER_AR.get(n, n), "c": round(c, 4)} for n, c in drivers],
            ensure_ascii=False))
        rats.append(rationale(df.iloc[i], drivers))
    df["top_drivers"] = tops
    df["rationale_ar"] = rats
    df["action_ar"] = df["risk_band"].map(ACTION_AR)

    cols = ["unit_id", "name_ar", "district_ar", "lon", "lat",
            "risk_raw", "risk_pct", "risk_rank", "risk_band", "risk_band_ar",
            "top_drivers", "rationale_ar", "action_ar", *feats]
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    df[cols].to_csv(OUT_CSV, index=False, encoding="utf-8")

    print(f"scored {len(df):,} segments -> {OUT_CSV.name}")
    if n_filled:
        print(f"  {n_filled:,} segments had a missing terrain value (median-filled)")
    print("  band distribution:")
    for _, key, ar in BANDS:
        n = int((df["risk_band"] == key).sum())
        print(f"    {key:<10} {ar:<8} {n:>6,}  ({100 * n / len(df):.1f}%)")
    print("  top 5 by susceptibility:")
    for _, r in df.nlargest(5, "risk_raw").iterrows():
        nm = r["name_ar"] if isinstance(r["name_ar"], str) else "(شارع بلا اسم)"
        print(f"    {r['risk_pct']:.3f}  {nm[:34]:<36} {r['district_ar']}")
    print("\n  transfer basis (leave-one-city-out):")
    for city, d in bundle["loco"].items():
        base = d.get('baseline', d.get('prevalence'))
        print(f"    {city:<8} PR-AUC {d['pr_auc']:.3f} vs baseline "
              f"{base:.3f}  = {d['lift']:.2f}x")


if __name__ == "__main__":
    main()
