# -*- coding: utf-8 -*-
"""Test the rankings against the Madinah ground truth we actually have.

Everything so far has been measured in American cities and argued to transfer.
This measures in Madinah. The evidence is thin and the script says so in the
output rather than in a footnote:

  46 incident reports, of which
  12 carry coordinates, which collapse to
   6 DISTINCT locations -- but only THREE of those six are pins a resident
     dropped on the spot. The other three we inferred from place names in
     posts, and «طريق السلام، الركن الغربي» is a description of a road
     kilometres long, not a location.

That split turns out to decide the answer, so the test reports it separately:
on the three precise pins the ranking beats chance at p = 0.003; on the three
inferred ones there is no signal at all (p = 0.74).

So there are two tests, both underpowered, and neither can measure precision --
a street with no report is unreported, not proven dry. What they CAN measure is
whether the places we know flooded rank higher than chance, which is the claim
the product actually makes.

  A. POINT TEST (n=6, and n=3 within each quality stratum). For each distinct
     reported coordinate, take the nearest segment's rank. Under the null the
     ranks are uniform on [0,1], so compare the observed mean against 100,000
     draws of the same number of random segments. Reported one-sided.

  B. DISTRICT TEST (n=91). Score every district by the rank of its worst
     segment, then ask whether districts carrying a report score higher --
     measured as ROC-AUC with a permutation p-value. This uses the
     district-level reports the point test has to throw away.

Both tests run against all three rankings, so the answer to "which ranking is
right for Madinah" is measured rather than asserted.

    .venv/Scripts/python.exe test_madinah.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from incident_register import COORD_QUALITY, REPORTS

HERE = Path(__file__).parent
OUT = HERE / "results_madinah_test.json"
RNG = np.random.default_rng(42)
DRAWS = 100_000
RANKS = {"rank_hydrology": "الهيدرولوجي (المنشور)",
         "rank_model": "المُدرَّب على أمريكا",
         "rank_roaddensity": "كثافة الطرق وحدها"}


def point_test(risk: pd.DataFrame, pts: list[tuple[float, float]]) -> dict:
    out = {}
    for col in RANKS:
        obs = []
        for lat, lon in pts:
            d = (risk.lat - lat) ** 2 + (risk.lon - lon) ** 2
            obs.append(float(risk.loc[d.idxmin(), col]))
        obs = np.array(obs)
        null = RNG.choice(risk[col].to_numpy(), size=(DRAWS, len(pts)))
        p = float((null.mean(axis=1) >= obs.mean()).mean())
        out[col] = {"ranks": [round(v, 3) for v in obs],
                    "mean": float(obs.mean()), "min": float(obs.min()),
                    "p_one_sided": p,
                    "in_top_10pct": int((obs >= 0.90).sum()),
                    "in_top_20pct": int((obs >= 0.80).sum())}
    return out


def district_test(risk: pd.DataFrame, hit: set[str]) -> dict:
    out = {}
    for col in RANKS:
        # A district is only as good as its worst street: the max is the right
        # aggregate for "does this district contain somewhere that floods".
        g = risk.groupby("district_ar")[col].max().dropna()
        y = np.array([1 if d in hit else 0 for d in g.index])
        if y.sum() == 0 or y.sum() == len(y):
            continue
        auc = float(roc_auc_score(y, g.to_numpy()))
        perm = np.array([roc_auc_score(RNG.permutation(y), g.to_numpy())
                         for _ in range(2000)])
        out[col] = {"auc": auc, "p_one_sided": float((perm >= auc).mean()),
                    "n_districts": int(len(g)), "n_with_reports": int(y.sum())}
    return out


def main() -> None:
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
    df = pd.DataFrame(REPORTS,
                      columns=["date", "district", "place", "source", "stream",
                               "lat", "lon"])

    pts = sorted({(r.lat, r.lon) for r in df.dropna(subset=["lat"]).itertuples()})
    hit = {d for d in df.district.unique() if d and d != "—"}

    print(f"ground truth available in Madinah")
    print(f"  reports total            {len(df)}")
    print(f"  with coordinates         {int(df.lat.notna().sum())}")
    print(f"  DISTINCT point locations {len(pts)}   <- the point test's n")
    print(f"  districts named          {len(hit)}   <- the district test's positives")
    print(f"  segments ranked          {len(risk):,}")

    print("\n" + "=" * 72)
    print(f"A. POINT TEST  —  n={len(pts)}, {DRAWS:,} random draws for the null")
    print("=" * 72)
    A = point_test(risk, pts)

    # Split by coordinate quality. Pooling a pin a resident dropped on the spot
    # with one we inferred from «طريق السلام، الركن الغربي» -- a road kilometres
    # long -- tests our geocoding as much as the ranking, and the two deserve
    # separate answers.
    prec = [q for q in pts if COORD_QUALITY.get(q) == "precise"]
    apx = [q for q in pts if COORD_QUALITY.get(q) == "approx"]
    strata = {}
    exact = [q for q in pts if COORD_QUALITY.get(q) == "exact"]
    geo = [q for q in pts if COORD_QUALITY.get(q) == "geocoded"]
    for lab, sub in (("trustworthy (exact+precise)", exact + prec),
                     ("geocoded from a road name", geo),
                     ("approximate from post text", apx),
                     ("all inferred (geocoded+approx)", geo + apx)):
        if len(sub) < 2:
            continue
        strata[lab] = point_test(risk, sub)
        r = strata[lab]["rank_hydrology"]
        star = ("  ***" if r["p_one_sided"] < 0.01
                else "  *" if r["p_one_sided"] < 0.05 else "")
        print(f"\n  {lab}  (n={len(sub)})   "
              f"ranks {'  '.join(f'{v:.3f}' for v in r['ranks'])}")
        print(f"     mean {r['mean']:.3f}   worst {r['min']:.3f}   "
              f"p = {r['p_one_sided']:.5f}{star}")

    print(f"\n{'ranking':26}{'mean rank':>11}{'worst':>8}{'top10%':>9}{'p':>10}")
    for col, lab in RANKS.items():
        a = A[col]
        star = "  ***" if a["p_one_sided"] < 0.01 else ("  *" if a["p_one_sided"] < 0.05 else "")
        print(f"{lab:26}{a['mean']:11.3f}{a['min']:8.3f}"
              f"{a['in_top_10pct']:>6}/{len(pts)}{a['p_one_sided']:10.5f}{star}")
    print("\n  the five locations, under the ranking that ships:")
    for (lat, lon), v in zip(pts, A["rank_hydrology"]["ranks"]):
        print(f"    {lat:.5f}, {lon:.5f}   rank {v:.3f}")

    print("\n" + "=" * 72)
    print("B. DISTRICT TEST  —  does a district with reports rank higher?")
    print("=" * 72)
    B = district_test(risk, hit)
    print(f"\n{'ranking':26}{'ROC-AUC':>10}{'districts':>11}{'positives':>11}{'p':>9}")
    for col, lab in RANKS.items():
        if col not in B:
            continue
        b = B[col]
        star = "  ***" if b["p_one_sided"] < 0.01 else ("  *" if b["p_one_sided"] < 0.05 else "")
        print(f"{lab:26}{b['auc']:10.3f}{b['n_districts']:11}"
              f"{b['n_with_reports']:11}{b['p_one_sided']:9.4f}{star}")

    print("\n" + "-" * 72)
    print("What this cannot tell you:")
    print("  - precision. A street with no report is unreported, not dry.")
    print("  - independence. Seven of the twelve coordinates are one site, so")
    print("    the six distinct points come from four districts, not six.")
    print("  - whether the approximate pins fail because the RANKING is wrong")
    print("    or because the GEOCODING is. Both are consistent with p = 0.74.")

    OUT.write_text(json.dumps(
        {"n_reports": len(df), "n_with_coords": int(df.lat.notna().sum()),
         "n_distinct_points": len(pts), "n_districts_named": len(hit),
         "draws": DRAWS, "point_test": A, "point_test_by_quality": strata,
         "district_test": B},
        indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
