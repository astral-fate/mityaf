# -*- coding: utf-8 -*-
"""Export the case file: every dated incident joined to what we said about it.

This is what turns the console from a map into a testable claim. For each
incident we know happened, the site can show, side by side:

    the date and place, as reported
    the rainfall that day from two independent reanalyses
    the rank our pipeline gave that street -- computed from terrain alone
    what each trained model predicted for it
    how good the coordinate is

The honesty this has to carry: the ranking is STATIC. It scores terrain, not
weather, so the same street holds the same rank every day. Nothing "alerted" on
4 January 2023 because nothing existed then. What the case file supports is a
retrodiction -- "it rained 12 mm that day, and this street was already in the
top 1% on terrain alone" -- and every field is named so the UI cannot
accidentally imply otherwise. There is no `alert` field, deliberately.

    .venv/Scripts/python.exe export_cases.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from incident_register import COORD_QUALITY, RESOLVED

HERE = Path(__file__).parent
WEB = HERE.parent / "apps" / "web" / "public" / "data"
OUT = WEB / "ponding-cases.json"

QUALITY_AR = {"exact": "مضبوط — من هندسة OSM نفسها",
              "precise": "دقيق — ساكن وضع النقطة على الخريطة",
              "geocoded": "مُرمَّز — مركز طريق مسمّى، لا موقع الغرق",
              "approx": "تقريبي — مستنتج من نصّ منشور"}
BAND = [(0.99, "حرج"), (0.90, "مرتفع"), (0.70, "متوسط"), (0.0, "منخفض")]


def band(v):
    for cut, name in BAND:
        if v is not None and v >= cut:
            return name
    return "غير محسوب"


def main() -> None:
    reg = pd.read_csv(HERE / "out" / "incidents" / "incident_register.csv")
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
    short = pd.read_csv(HERE / "out" / "shortlist" / "inspection_shortlist.csv")
    try:
        preds = json.loads((HERE / "results_groundtruth_predictions.json")
                           .read_text(encoding="utf-8"))
        pred_by_seg = {}
        for i, L in enumerate(preds["locations"]):
            pred_by_seg[L["unit_id"]] = {
                m["model"]: round(m["per_location"][i], 3) for m in preds["models"]}
    except Exception:                                             # noqa: BLE001
        pred_by_seg = {}

    mech = dict(zip(short.unit_id, short.mechanism))
    cases = []
    for r in reg.itertuples():
        c = {"date": r.date, "district": r.district, "place": r.place,
             "source": r.source, "stream": r.stream,
             "rain": {"era5_mm": None if pd.isna(r.era5_peak_mm) else round(float(r.era5_peak_mm), 1),
                      "power_mm": None if pd.isna(r.power_peak_mm) else round(float(r.power_peak_mm), 1),
                      "peak_mm": None if pd.isna(r.best_mm) else round(float(r.best_mm), 1),
                      "corroborated": bool(r.corroborated),
                      "via": r.which_source}}
        if not pd.isna(r.lat):
            q = COORD_QUALITY.get((float(r.lat), float(r.lon)), "approx")
            d = np.sqrt((risk.lat - r.lat) ** 2 + (risk.lon - r.lon) ** 2)
            k = d.idxmin()
            s = risk.loc[k]
            c["location"] = {
                "lat": float(r.lat), "lon": float(r.lon),
                "quality": q, "qualityNote": QUALITY_AR[q],
                "trusted": q in ("exact", "precise"),
                "distanceM": round(float(d[k]) * 111000)}
            c["segment"] = {
                "id": s.unit_id, "name": None if pd.isna(s.name_ar) else s.name_ar,
                "district": None if pd.isna(s.district_ar) else s.district_ar,
                "mechanism": mech.get(s.unit_id),
                # NB rank, not probability -- a percentile within Madinah
                "rankHydrology": round(float(s.rank_hydrology), 3),
                "rankModel": round(float(s.rank_model), 3),
                "rankRoadDensity": round(float(s.rank_roaddensity), 3),
                "band": band(float(s.rank_hydrology)),
                "predictions": pred_by_seg.get(s.unit_id)}
        cases.append(c)

    cases.sort(key=lambda c: c["date"], reverse=True)
    located = [c for c in cases if "segment" in c]
    trusted = [c for c in located if c["location"]["trusted"]]
    top1 = [c for c in located if c["segment"]["rankHydrology"] >= 0.99]
    top10 = [c for c in located if c["segment"]["rankHydrology"] >= 0.90]

    payload = {
        "count": len(cases),
        "counts": {
            "total": len(cases),
            "corroborated": sum(c["rain"]["corroborated"] for c in cases),
            "located": len(located),
            "trusted": len(trusted),
            "inTop1Pct": len(top1),
            "inTop10Pct": len(top10),
            "resolved": len(RESOLVED),
        },
        "note": ("الترتيب ثابت ويُحسب من التضاريس وحدها، فهو لا يتغيّر بتغيّر "
                 "اليوم. ما يعرضه هذا السجلّ هو مطابقة بأثر رجعي: كم هطل في "
                 "ذلك اليوم، وما الرتبة التي كان الشارع يحملها أصلاً."),
        "districts": sorted({c["district"] for c in cases if c["district"] != "—"}),
        "years": sorted({c["date"][:4] for c in cases}, reverse=True),
        "resolvedSites": [
            {"lat": s["lat"], "lon": s["lon"], "district": s["district"],
             "from": s["observed_from"], "until": s["observed_until"],
             "fixedWhen": s["resolved_when"], "fixedBy": s["resolved_by"],
             "note": s["note"], "whyMissed": s["why_we_missed_it"],
             "ourRank": s["our_rank_hydrology"], "ourSink": s["our_sink_m"]}
            for s in RESOLVED],
        "items": cases,
    }
    WEB.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                   encoding="utf-8")

    c = payload["counts"]
    print(f"wrote {OUT.name}  ({OUT.stat().st_size/1024:.0f} KB)")
    print(f"  {c['total']} cases   {c['corroborated']} corroborated by rainfall")
    print(f"  {c['located']} with coordinates, {c['trusted']} of them trustworthy")
    print(f"  {c['inTop1Pct']} rank in the city's worst 1%, "
          f"{c['inTop10Pct']} in the worst 10%")
    print(f"  {c['resolved']} site fixed on the ground and no longer floods")


if __name__ == "__main__":
    main()
