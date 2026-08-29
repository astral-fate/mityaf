"""The inspection shortlist: two mechanisms, one ranked list, real coordinates.

Nine reported flood sites across Madinah divide cleanly into two physical
types, and a filter built for one misses the other entirely:

  TYPE 1  CLOSED DEPRESSION -- water arrives and cannot leave.
          sink > 0.05 m and HAND < 0: below the local drainage line, in a
          hollow, on flat ground. Verified at حي الملك فهد, where three
          independent pins landed in a 57-segment basin 0.69 m deep and the
          eyewitness account is "water stays 2-3 days until tankers pump it".

  TYPE 2  RUNOFF CONVERGENCE -- water arrives fast and sheets across.
          High flow accumulation on flat ground, but ABOVE the drainage line
          and with no hollow. Reported at شارع البخاري, حي السلام and
          حي العزيزية, none of which contain a single depression segment.
          شارع البخاري is locally called "مسلسل غرق يتكرر" -- a recurring
          flooding serial -- and the Type 1 filter scores it 0.

The distinction is operational, not academic. A depression needs drainage
built into it or it will be pumped after every storm forever. A convergence
point needs interception upslope. Same symptom, different remedy.

Scoring within each type is by severity, then the two lists are merged and
ranked by a common percentile so one inspection round covers both.

    .venv/Scripts/python.exe shortlist.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
OUT = HERE / "out" / "shortlist"

# Sites reported by residents or found on X, with the rainfall-confirmed dates.
REPORTED = {
    "الملك فهد": "3 pins verified; 6 dated events",
    "قباء": "19-20 Aug 2022",
    "التلعة": "30 Aug 2024 (27.5 mm, NASA POWER)",
    "السلام": "29 Apr 2024",
    "العزيزية": "29-30 Apr 2024",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    r = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
    f = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    f.columns = [c.lstrip("﻿") for c in f.columns]
    d = r.merge(f[["unit_id", "sink", "slope", "hand", "twi", "logacc",
                   "relelev", "road_density"]], on="unit_id", how="left")
    d["district_ar"] = d["district_ar"].astype(str)

    flow_hi = d["logacc"].quantile(0.90)

    t1 = d[(d["sink"] > 0.05) & (d["hand"] < 0)].copy()
    t1["mechanism"] = "depression"
    # severity: deep, flat, and well below the drainage line
    t1["severity"] = (t1["sink"].rank(pct=True) * 0.5
                      + (-t1["slope"]).rank(pct=True) * 0.25
                      + (-t1["hand"]).rank(pct=True) * 0.25)

    t2 = d[(d["logacc"] >= flow_hi) & (d["slope"] < 1.0)
           & ~d.index.isin(t1.index)].copy()
    t2["mechanism"] = "convergence"
    # severity: a lot of water arriving onto ground too flat to shed it
    t2["severity"] = (t2["logacc"].rank(pct=True) * 0.6
                      + (-t2["slope"]).rank(pct=True) * 0.4)

    both = pd.concat([t1, t2], ignore_index=True)
    # Rank WITHIN each mechanism. A single pooled ranking is dominated by
    # convergence, which outnumbers depressions four to one, and buries the
    # one mechanism that has actually been verified on the ground.
    both["priority"] = both.groupby("mechanism")["severity"].rank(pct=True)
    both["reported_district"] = both["district_ar"].isin(REPORTED)
    both = both.sort_values("priority", ascending=False)

    cols = ["unit_id", "district_ar", "name_ar", "lat", "lon", "mechanism",
            "priority", "severity", "sink", "slope", "hand", "logacc",
            "rank_hydrology", "rank_model", "rank_roaddensity",
            "ood_flag", "reported_district"]
    both[cols].to_csv(OUT / "inspection_shortlist.csv", index=False,
                      encoding="utf-8")
    both[both.mechanism == "depression"][cols].to_csv(
        OUT / "type1_depressions.csv", index=False, encoding="utf-8")
    both[both.mechanism == "convergence"][cols].to_csv(
        OUT / "type2_convergence.csv", index=False, encoding="utf-8")

    print(f"\n  flow-accumulation 90th percentile = {flow_hi:.2f}\n")
    print(f"  TYPE 1  depression   {len(t1):5,} segments ({len(t1)/len(d):.2%})")
    print(f"  TYPE 2  convergence  {len(t2):5,} segments ({len(t2)/len(d):.2%})")
    print(f"  combined shortlist   {len(both):5,} segments "
          f"({len(both)/len(d):.2%} of the network)")

    print(f"\n  districts already reporting floods hold "
          f"{int(both.reported_district.sum()):,} of them "
          f"({both.reported_district.mean():.1%})")

    print("\n  how each ranking scores the shortlist (median percentile):")
    for c, lab in [("rank_hydrology", "hydrology"), ("rank_model", "trained model"),
                   ("rank_roaddensity", "road density")]:
        a = both[both.mechanism == "depression"][c].median()
        b = both[both.mechanism == "convergence"][c].median()
        print(f"    {lab:15} depression {a:.3f}   convergence {b:.3f}")

    print("\n  top 15 for inspection:\n")
    print(f"    {'lat':>9}{'lon':>10}  {'mech':<12}{'sink':>6}{'slope':>7}"
          f"{'logacc':>8}  district")
    pick = pd.concat([both[both.mechanism == m].nlargest(8, "priority")
                      for m in ("depression", "convergence")])
    for _, s in pick.iterrows():
        print(f"    {s.lat:9.5f}{s.lon:10.5f}  {s.mechanism:<12}{s.sink:6.2f}"
              f"{s.slope:7.2f}{s.logacc:8.2f}  {s.district_ar}")

    print("\n  by district, top 12:\n")
    g = (both.groupby("district_ar")
         .agg(n=("unit_id", "size"),
              depressions=("mechanism", lambda x: (x == "depression").sum()),
              convergence=("mechanism", lambda x: (x == "convergence").sum()),
              top_priority=("priority", "max"))
         .sort_values("n", ascending=False).head(12))
    print(f"    {'district':<18}{'total':>6}{'depr':>6}{'conv':>6}{'best':>7}  reported")
    for name, row in g.iterrows():
        mark = "  <-- yes" if name in REPORTED else ""
        print(f"    {name:<18}{int(row.n):6d}{int(row.depressions):6d}"
              f"{int(row.convergence):6d}{row.top_priority:7.3f}{mark}")

    print(f"\n  wrote {OUT}")


if __name__ == "__main__":
    main()
