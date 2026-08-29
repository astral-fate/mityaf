# -*- coding: utf-8 -*-
"""Feed the 11 known flood streets into every model and print what it predicts.

Not a ranking. Eleven streets we have proof flooded go in; each model's raw
predicted probability comes out. The question is simply: does the model say
this street is bad?

Each model was trained with class weighting so its output is calibrated near
the training prevalence (~30% of US cells are flood-positive). So p >= 0.50 is
the natural reading of "this model predicts this street floods", and that is
what the PASS/FAIL column uses. The model's own median over all 30,337 Madinah
segments is printed too, because a model that scores everything 0.9 is not
detecting anything -- the prediction only means something relative to what that
model says about an ordinary street.

    .venv/Scripts/python.exe predict_groundtruth.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from domain_adapt import DEM
from incident_register import COORD_QUALITY, REPORTS
from normalise_madinah import rank_against
from train_and_save import STORE, predict
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_groundtruth_predictions.json"
THRESH = 0.50


def main() -> None:
    grid = build_matrix("madinah")
    keys = list(grid[3])
    dem = [i for i, k in enumerate(keys) if k in DEM]

    seg = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    X = rank_against(seg[keys].to_numpy("float32"), grid[0], dem)

    df = pd.DataFrame(REPORTS, columns=["date", "district", "place", "source",
                                        "stream", "lat", "lon"])
    gt = (df.dropna(subset=["lat"])
            .drop_duplicates(subset=["lat", "lon"])
            .sort_values(["district", "date"]).reset_index(drop=True))
    rows = []
    for r in gt.itertuples():
        d = np.sqrt((seg.lat - r.lat) ** 2 + (seg.lon - r.lon) ** 2) * 111000
        k = int(d.idxmin())
        rows.append({"lat": r.lat, "lon": r.lon, "district": r.district,
                     "date": r.date, "place": r.place,
                     "quality": COORD_QUALITY.get((r.lat, r.lon), "?"),
                     "seg_idx": k, "unit_id": seg.loc[k, "unit_id"],
                     "dist_m": float(d[k])})
    idx = [x["seg_idx"] for x in rows]

    models = sorted(q.stem for q in STORE.glob("*.joblib") if q.stem != "always_negative")
    preds, medians = {}, {}
    for m in models:
        try:
            p = predict(m, X, keys)
        except Exception as e:                                    # noqa: BLE001
            print(f"  {m} skipped: {type(e).__name__}"); continue
        preds[m] = p[idx]
        medians[m] = float(np.median(p))

    print(f"\nPREDICTIONS ON THE {len(rows)} STREETS WE KNOW FLOODED")
    print(f"models trained on US cities only. p >= {THRESH:.2f} = "
          f"'this model says the street floods'\n")

    ok = list(preds)
    w = 11
    print(f"{'#':>2} {'district':14}{'quality':10}" + "".join(f"{m[:10]:>{w}}" for m in ok))
    print("-" * (26 + w * len(ok)))
    for i, x in enumerate(rows, 1):
        line = f"{i:>2} {x['district'][:13]:14}{x['quality']:10}"
        for m in ok:
            v = preds[m][i - 1]
            line += f"{v:>{w-1}.3f}" + ("*" if v >= THRESH else " ")
        print(line)
    print("-" * (26 + w * len(ok)))
    print(f"{'':2} {'HITS (p>=0.5)':24}" +
          "".join(f"{int((preds[m] >= THRESH).sum()):>{w-3}}/{len(rows):<2}" for m in ok))
    print(f"{'':2} {'city-wide median':24}" +
          "".join(f"{medians[m]:>{w}.3f}" for m in ok))
    print(f"{'':2} {'above own median':24}" +
          "".join(f"{int((preds[m] > medians[m]).sum()):>{w-3}}/{len(rows):<2}" for m in ok))

    print("\n" + "=" * 78)
    print("VERDICT PER MODEL")
    print("=" * 78)
    print(f"{'model':22}{'hits p>=0.5':>13}{'above median':>14}{'mean p':>9}"
          f"{'median p':>10}")
    summary = []
    for m in ok:
        hits = int((preds[m] >= THRESH).sum())
        above = int((preds[m] > medians[m]).sum())
        summary.append({"model": m, "hits": hits, "above_median": above,
                        "mean_p": float(preds[m].mean()),
                        "city_median": medians[m],
                        "per_location": [float(v) for v in preds[m]]})
        print(f"{m:22}{hits:>9}/{len(rows):<3}{above:>10}/{len(rows):<3}"
              f"{preds[m].mean():9.3f}{medians[m]:10.3f}")

    print(f"\nUnder chance, 'above own median' would be {len(rows)/2:.1f}/{len(rows)}.")
    print("A model beats chance on these streets only if it clears that.")

    OUT.write_text(json.dumps({"threshold": THRESH, "locations": rows,
                               "models": summary}, indent=1, ensure_ascii=False),
                   encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
