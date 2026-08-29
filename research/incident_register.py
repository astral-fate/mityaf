"""Incident register for street flooding in Al Madinah.

Fifteen reports from two independent streams -- resident recollection with
coordinates, and posts found on X -- each checked against rainfall.

Verification uses TWO reanalysis sources, and that is not belt-and-braces. ERA5
is effectively blind to summer convection here: it records 0.00 days above
5 mm in August across 11.7 years, while 30 August 2024 shows 27.5 mm in NASA
POWER and has street flooding on video. Judging a summer report by ERA5 alone
rejects real events. A report counts as corroborated if EITHER source shows
>= 1 mm within three days.

Locations carry a mechanism where the terrain is known:

  depression   a closed hollow below the drainage line; water arrives and
               cannot leave, so it stays for days until tankers pump it.
               Verified at حي الملك فهد -- three pins inside one 57-segment
               basin 0.69 m deep.
  convergence  high flow accumulation on flat ground above the drainage line;
               water sheets across during the storm and drains after.
               شارع البخاري, حي السلام, حي العزيزية -- none of which contain a
               single depression segment.

    .venv/Scripts/python.exe incident_register.py
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
OUT = HERE / "out" / "incidents"
SITE = (24.5040022, 39.7000415)          # the verified King Fahd basin
PONDING_MM = 5.0

# date, district, place as reported, source, stream, lat, lon (blank if unknown)
REPORTS = [
    ("2017-08-18", "—", "شوارع المدينة، فجر الجمعة", "@NibiruNews1", "x", None, None),
    ("2018-10-31", "—", "شوارع وطرق أحياء المدينة", "@Almadin26146411", "x", None, None),
    ("2022-04-28", "الملك فهد", "عبدالله ابن اسلم البلوي", "resident", "resident", 24.5040022, 39.7000415),
    ("2022-08-15", "الملك فهد", "حي الملك فهد — بقي الماء حتى ضخّته الصهاريج", "resident", "resident", 24.5040022, 39.7000415),
    ("2022-08-20", "قباء", "شارع الإمام مسلم / قرب قباء", "@NewKhalij", "x", None, None),
    ("2022-11-11", "الملك فهد", "حي الملك فهد", "resident", "resident", 24.5040022, 39.7000415),
    ("2023-01-04", "الملك فهد", "شوارع حي الملك فهد — ماء راكد", "resident", "resident", 24.5040022, 39.7000415),
    ("2024-04-29", "السلام", "طريق السلام، الركن الغربي", "resident + @samir_gabbani", "both", 24.4823, 39.5097),
    ("2024-04-29", "العزيزية", "شارع البخاري", "@t_3r0", "x", 24.44919, 39.52306),
    ("2024-08-16", "—", "شوارع المدينة المنورة", "@1984_asd", "x", None, None),
    ("2024-08-28", "الملك فهد", "حي الملك فهد", "resident", "resident", 24.5040022, 39.7000415),
    ("2024-08-30", "التلعة", "حي تلعة الهبوب / قصر السعد", "@AskAlmadinah30", "x", 24.50561, 39.65355),
    ("2025-03-30", "الملك فهد", "حي الملك فهد", "resident", "resident", 24.5040022, 39.7000415),
    ("2025-12-07", "الملك فهد", "حي الملك فهد", "resident", "resident", 24.5040022, 39.7000415),
    ("2026-03-26", "الملك فهد", "حديقة الجبل", "resident", "resident", 24.503704, 39.702222),
    ("2015-11-19", "—", "حي الغربية / الجبور — الماء يبقى حتى خمسة أيام", "Al-Madina", "research", None, None),
    ("2018-02-25", "العزيزية", "طريق الهجرة — سلطانة، مخطط باقدو", "Al-Madina", "research", None, None),
    ("2018-12-03", "—", "شوارع", "Okaz", "research", None, None),
    ("2019-11-10", "—", "شوارع المدينة", "research agent", "research", None, None),
    ("2024-04-30", "السلام", "طريق السلام", "research agent", "research", None, None),
    ("2024-08-31", "—", "المسجد النبوي / البقيع", "Al Jazeera Mubasher", "research", None, None),
    ("2025-01-06", "السلام", "طريق السلام / الجامعة", "Okaz", "research", None, None),
    ("2025-12-09", "التلعة", "طريق السلام / الدائري الثاني / طريق الجامعات", "Okaz", "research", None, None),
    ("2016-08-08", "—", "بلاغ مسجَّل دون تأكيد", "research agent", "research", None, None),
    ("2017-10-04", "الجرف", "بلاغ مسجَّل دون تأكيد", "research agent", "research", None, None),
    ("2018-05-03", "—", "بلاغ مسجَّل دون تأكيد", "research agent", "research", None, None),
    ("2019-03-16", "قباء", "صلاح الدين الأيوبي / قباء — مياه راكدة", "Okaz", "research", None, None),
    ("2019-06-09", "طيبة", "حي طيبة — قنوات السيول", "Okaz", "research", None, None),
    ("2020-06-20", "الخالدية", "بلاغ مسجَّل دون تأكيد", "research agent", "research", None, None),
    ("2020-07-25", "—", "بلاغ مسجَّل دون تأكيد", "research agent", "research", None, None),
    ("2020-08-20", "—", "بلاغ مسجَّل دون تأكيد", "research agent", "research", None, None),
    ("2024-01-14", "—", "بلاغ مسجَّل دون تأكيد", "Al-Madina", "research", None, None),
    ("2024-08-29", "السلام", "السلام / قربان", "research agent", "research", None, None),
    ("2025-12-03", "السلام", "السلام / العزيزية", "research agent", "research", None, None),
    ("2026-08-25", "السلام", "السلام / الجامعة", "Okaz", "research", None, None),
    ("2015-05-05", "—", "نفق الملك عبدالله — تجمع مائي حاد داخل النفق", "SPA", "research", None, None),
    ("2015-10-12", "—", "بلاغ مسجَّل دون تأكيد", "Al-Riyadh", "research", None, None),
    ("2016-01-18", "—", "بلاغ مسجَّل دون تأكيد", "Al-Madina", "research", None, None),
    ("2016-02-10", "—", "بلاغ مسجَّل دون تأكيد", "Al-Madina", "research", None, None),
    ("2016-11-14", "—", "بلاغ مسجَّل دون تأكيد", "Okaz", "research", None, None),
    ("2017-05-22", "—", "بلاغ مسجَّل دون تأكيد", "Al-Madina", "research", None, None),
    ("2017-11-15", "المطار", "بلاغ مسجَّل دون تأكيد", "research agent", "research", None, None),
    ("2018-12-18", "—", "بلاغ مسجَّل دون تأكيد", "SPA", "research", None, None),
    ("2019-05-15", "—", "بلاغ مسجَّل دون تأكيد", "Okaz", "research", None, None),
    ("2015-05-12", "المطار", "بلاغ مسجَّل دون تأكيد", "SPA", "research", None, None),
    ("2022-06-01", "القبلتين", "مغور صناعية — تجمّع مستمر حتى تمهيد الأرض",
     "resident", "resident", 24.4703460, 39.5779570),
    ("2015-05-05", "مسجد الدرع", "نفق الملك عبدالله (from our own OSM tunnel tab", "geocoded", "research", 24.49614015, 39.6088314),
    ("2024-04-30", "السلام", "طريق السلام، المدينة المنورة", "geocoded", "research", 24.4670222, 39.6026016),
    ("2024-08-31", "المركزية", "البقيع، المدينة المنورة", "geocoded", "research", 24.4667491, 39.6161724),
    ("2025-12-09", "التلعة", "الطريق الدائري الثاني، المدينة المنورة", "geocoded", "research", 24.4973401, 39.6353561),
    ("2024-08-29", "السلام", "قربان، المدينة المنورة", "geocoded", "research", 24.4535566, 39.6230506),
]

# The mechanism vocabulary is closed at exactly three keys; anything the
# terrain does not place into one of them carries None, never a fourth
# sentinel string. `ponding-segments.json` already spells "no mechanism" as
# null and the two files must not disagree.
# Coordinate quality, because it decides what the Madinah test can conclude.
# "precise" means a resident opened a map and dropped a pin on the spot. "approx"
# means we derived a point from a place name in a post -- «طريق السلام، الركن
# الغربي» is a description of a road kilometres long, not a location.
#
# test_madinah.py shows why this matters: the two precise pins rank 0.990 and
# 0.994, the three approximate ones 0.380, 0.003 and 0.789, and over all five the
# ranking does not beat chance (p = 0.159, n = 5). Reporting "three pins in the
# top 1%" without this distinction would be reporting a selected subset.
COORD_QUALITY = {
    (24.5040022, 39.7000415): "precise",   # resident dropped this pin
    (24.503704, 39.702222):   "precise",   # resident dropped this pin
    (24.4823, 39.5097):       "approx",    # from «طريق السلام، الركن الغربي»
    (24.44919, 39.52306):     "approx",    # from «شارع البخاري», 2.4 km long
    (24.50561, 39.65355):     "approx",    # from «حي تلعة الهبوب / قصر السعد»
    (24.4703460, 39.5779570): "precise",   # resident dropped this pin
    # Added by geocode_reports.py. "exact" is our own OSM tunnel geometry;
    # "geocoded" is Nominatim returning a representative node on a named
    # road, which is NOT the spot that flooded. Eight of the thirteen named
    # locations could not be found at all -- شارع الإمام مسلم, حي الغربية,
    # حي طيبة and صلاح الدين الأيوبي are simply absent from OSM here, the
    # same coverage gap that hides حي الغربية from the platform entirely.
    (24.49614015, 39.6088314): "exact",   # نفق الملك عبدالله (from our own OSM tunnel table)
    (24.4670222, 39.6026016): "geocoded",   # طريق السلام، المدينة المنورة
    (24.4667491, 39.6161724): "geocoded",   # البقيع، المدينة المنورة
    (24.4973401, 39.6353561): "geocoded",   # الطريق الدائري الثاني، المدينة المنورة
    (24.4535566, 39.6230506): "geocoded",   # قربان، المدينة المنورة
}

# Sites where ponding was observed and then STOPPED after ground works. These
# are worth more than an incident report: each is a natural experiment on
# whether changing the terrain changes the outcome, which is the entire premise
# of the depression remedy.
#
# The first entry also marks a real limit of the method. Copernicus GLO-30
# derives from TanDEM-X acquisitions flown 2011-2015, so ground reshaped after
# that is invisible to us -- and a pit narrower than a 30 m cell is invisible at
# any date. That is why we read sink = 0.000 on a site that demonstrably held
# water for two years: the natural terrain there is a hillside falling 18.6 m
# across 390 m, and the water was held by man-made excavation sitting inside a
# single cell.
RESOLVED = [
    {"lat": 24.4703460, "lon": 39.5779570,
     "district": "القبلتين",
     "observed_from": "2022", "observed_until": "2024",
     "resolved_by": "إزالة المغور الصناعية وتمهيد الأرض",
     "resolved_when": "2024-2025",
     "source": "resident",
     "note": ("كانت المياه تتجمّع في مغور صناعية — حفرٌ من أعمال سابقة. بعد "
              "إزالتها وتمهيد الأرض توقّف التجمّع تماماً."),
     "our_slope_deg": 2.322, "our_sink_m": 0.000, "our_hand_m": -4.77,
     "our_twi": 12.09, "our_rank_hydrology": 0.766,
     "our_mechanism": None,
     "why_we_missed_it": ("المصدر حفرٌ من صنع الإنسان أصغر من خليّة 30 متراً، "
                          "فلا يراها نموذج الارتفاع. والتضاريس الطبيعية هنا "
                          "منحدر ينزل 18.6 متراً عبر 390 متراً، لا حوض.")},
]

MECHANISM = {"الملك فهد": "depression", "قباء": "depression",
             "التلعة": "depression", "السلام": "convergence",
             "العزيزية": "convergence"}

# A few reports name the structure rather than a district, and the structure
# decides the mechanism: an underpass is below grade by construction wherever
# it sits. Keyed by date because that is what identifies a report here.
MECHANISM_BY_DATE = {"2015-05-05": "tunnel"}   # نفق الملك عبدالله

# ERA5 and NASA POWER are proper nouns and stay Latin. "both" and "neither"
# are English common words and this column is rendered verbatim in an Arabic
# table, so they are written in Arabic at the source.
SOURCE_BOTH = "المصدران"
SOURCE_NEITHER = "لا مصدر"


def era5(lat, lon, a, b):
    q = ("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "start_date": a, "end_date": b,
        "daily": "precipitation_sum", "timezone": "auto"}))
    d = json.load(urllib.request.urlopen(q, timeout=180))["daily"]
    return pd.Series([x or 0.0 for x in d["precipitation_sum"]],
                     index=pd.to_datetime(d["time"]))


def power(lat, lon, a, b):
    q = ("https://power.larc.nasa.gov/api/temporal/daily/point?" + urllib.parse.urlencode({
        "parameters": "PRECTOTCORR", "community": "AG", "longitude": lon,
        "latitude": lat, "start": a.replace("-", ""), "end": b.replace("-", ""),
        "format": "JSON"}))
    d = json.load(urllib.request.urlopen(q, timeout=180))
    p = d["properties"]["parameter"]["PRECTOTCORR"]
    s = pd.Series({pd.Timestamp(f"{k[:4]}-{k[4:6]}-{k[6:]}"): (v if v >= 0 else 0.0)
                   for k, v in p.items()})
    return s.sort_index()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    A, B = "2015-01-01", "2026-08-28"
    e_city = era5(*SITE, A, B)
    p_city = power(*SITE, A, B)

    rows = []
    for date, dist, place, src, stream, lat, lon in REPORTS:
        t = pd.Timestamp(date)
        lo, hi = t - pd.Timedelta(days=3), t
        e = e_city.loc[lo:hi]
        p = p_city.loc[lo:hi] if len(p_city) else pd.Series(dtype=float)
        e_max = float(e.max()) if len(e) else np.nan
        p_max = float(p.max()) if len(p) else np.nan
        best = np.nanmax([e_max, p_max])
        rows.append({
            "date": date, "district": dist, "place": place,
            "source": src, "stream": stream,
            "lat": lat, "lon": lon,
            "mechanism": MECHANISM_BY_DATE.get(date) or MECHANISM.get(dist),
            "era5_peak_mm": round(e_max, 2), "power_peak_mm": round(p_max, 2),
            "best_mm": round(float(best), 2),
            "corroborated": bool(best >= 1.0),
            "which_source": (SOURCE_BOTH if e_max >= 1 and p_max >= 1
                             else "ERA5" if e_max >= 1
                             else "NASA POWER" if p_max >= 1 else SOURCE_NEITHER),
        })

    reg = pd.DataFrame(rows).sort_values("date")
    reg.to_csv(OUT / "incident_register.csv", index=False, encoding="utf-8")

    print(f"\n{'date':12}{'district':<12}{'ERA5':>7}{'POWER':>8}{'conf':>6}"
          f"  {'via':<11}{'mechanism':<12}source")
    for _, r in reg.iterrows():
        print(f"  {r.date:10}{r.district:<12}{r.era5_peak_mm:7.1f}"
              f"{r.power_peak_mm:8.1f}{'yes' if r.corroborated else 'NO':>6}"
              f"  {r.which_source:<11}{(r.mechanism or '-'):<12}{r.source}")

    n = int(reg.corroborated.sum())
    print(f"\n  {n} of {len(reg)} corroborated")
    only_power = reg[(reg.power_peak_mm >= 1) & (reg.era5_peak_mm < 1)]
    print(f"  {len(only_power)} would have been REJECTED on ERA5 alone: "
          f"{', '.join(only_power.date)}")
    print(f"\n  by stream:  resident {int((reg.stream=='resident').sum())}"
          f"   X {int((reg.stream=='x').sum())}"
          f"   both {int((reg.stream=='both').sum())}")
    print(f"  by mechanism: " + "  ".join(
        f"{k} {int(v)}" for k, v in reg.mechanism.value_counts(dropna=False).items()))
    print(f"  with coordinates: {int(reg.lat.notna().sum())}")

    wet = pd.DataFrame({"era5": e_city, "power": p_city}).fillna(0)
    wet["peak"] = wet.max(axis=1)
    big = wet[wet.peak >= PONDING_MM]
    seen = set(reg.date)
    unrec = [d for d in big.index.strftime("%Y-%m-%d")
             if not any(abs((pd.Timestamp(d) - pd.Timestamp(s)).days) <= 3
                        for s in seen)]
    pd.DataFrame({"date": unrec,
                  "peak_mm": [round(float(wet.loc[pd.Timestamp(d), "peak"]), 1)
                              for d in unrec]}).to_csv(
        OUT / "predicted_ponding_days.csv", index=False)
    print(f"\n  days >= {PONDING_MM:.0f} mm on either source: {len(big)} "
          f"({len(big)/(len(wet)/365.25):.1f}/yr)")
    print(f"  of those, {len(unrec)} have no matching report -- predictions to check")
    print(f"\n  resolved sites on record: {len(RESOLVED)}")
    for r in RESOLVED:
        print(f"    {r['district']:12} {r['observed_from']}-{r['observed_until']}"
              f" -> fixed {r['resolved_when']}  ({r['resolved_by']})")
        print(f"      our reading: sink {r['our_sink_m']:.3f} m, slope "
              f"{r['our_slope_deg']:.2f} deg, hyd rank {r['our_rank_hydrology']:.3f}, "
              f"mechanism {r['our_mechanism']}")

    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
