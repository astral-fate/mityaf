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
]

# The mechanism vocabulary is closed at exactly three keys; anything the
# terrain does not place into one of them carries None, never a fourth
# sentinel string. `ponding-segments.json` already spells "no mechanism" as
# null and the two files must not disagree.
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
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
