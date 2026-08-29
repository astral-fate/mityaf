# -*- coding: utf-8 -*-
"""A defensible cost model for running مِطياف on Azure, with real imagery.

The deck said «102,000 ريال سنوياً» with nothing behind it. That number does not
survive a procurement question, so this computes the cost from unit rates that
can each be checked, and states plainly how confident we are in each one.

Three tiers, because the cost is dominated by a single decision -- whether you
buy commercial imagery at all:

  TIER 1  open data only. Copernicus DEM, OpenStreetMap, ERA5, NASA POWER.
          This is the platform as it exists today; the imagery line is zero.
  TIER 2  add a daily commercial optical feed for change detection.
  TIER 3  add tasked very-high-resolution and radar per rain event, and a
          one-off aerial LiDAR survey.

CONFIDENCE. Azure line items come from the published Pay-As-You-Go rate card
and are firm to roughly +/-15% -- the variance is region and egress, not SKU.
The imagery lines are NOT quotes. Commercial EO vendors price by negotiated
contract with area, revisit and licence terms all variable, and published
figures are indicative ranges only. Every imagery number below carries its
basis, and the slide must present them as an order of magnitude, not a bid.

    .venv/Scripts/python.exe cost_model.py
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "results_cost_model.json"

SAR = 3.75                      # riyal per USD, pegged
AOI_KM2 = 545                   # Al Madinah AOI, from cache/madinah/meta.json
NETWORK_KM = 5_280
SEGMENTS = 30_337

# ── Azure, monthly USD, Pay-As-You-Go, West Europe / UAE North ──────────────
# SKUs chosen for a single-city deployment with a nightly pipeline, not for a
# multi-tenant SaaS. Confidence: firm. These are rate-card numbers.
AZURE = [
    ("Container Apps", "2 vCPU · 4 GB · always-on", 110,
     "يشغّل الواجهة و API"),
    ("PostgreSQL Flexible", "B4ms · 256 GB · PostGIS · نسخ احتياطي", 195,
     "قاعدة المقاطع والبلاغات"),
    ("Blob Storage", "750 GB ساخن + عمليات", 22,
     "النماذج الرقمية والبلاطات"),
    ("Egress", "500 GB/شهر", 40,
     "تحميل الخرائط للمستخدمين"),
    ("Front Door / CDN", "Standard", 45,
     "توزيع البلاطات"),
    ("Batch compute", "D8as_v5 spot · 60 ساعة/شهر", 28,
     "إعادة بناء المؤشّرات والنماذج"),
    ("Log Analytics", "5 GB/شهر", 15,
     "المراقبة والتشخيص"),
    ("Key Vault + misc", "", 10, ""),
]
RESERVED_SAVING = 0.25          # 1-year reserved on the DB and app plan

# ── commercial imagery, indicative annual USD ───────────────────────────────
# NOT quotes. Basis stated per line; ranges reflect published vendor guidance
# and typical minimum contract sizes, which dominate at this AOI.
PLANET = (25_000, 45_000,
          "الحد الأدنى للعقد التجاري يحكم السعر عند 545 كم²، لا سعر الكيلومتر")

# Very-high-resolution tasking is priced per km² over a minimum order area.
# That minimum is the whole argument for the free layer: tasking the full AOI
# buys 545 km² of 30 cm imagery, almost all of it over ground the ranking has
# already cleared. Tasking only the flagged segments still pays the 100 km²
# floor -- but the floor, not the city, is what you pay for.
VHR_USD_PER_KM2 = (25, 45)
VHR_MIN_ORDER_KM2 = 100
SAR_SCENE = (4_000, 8_000,
             "سعر المشهد المكلَّف؛ الرادار وحده يعمل أثناء العاصفة")

LIDAR = (100, 200, "دولار/كم² لمسح جوي بالليدار — تكلفة رأسمالية لمرة واحدة")
VHR_EVENTS_PER_YEAR = 3         # tasked captures after major rain events
SAR_SCENES_PER_YEAR = 4

IMAGERY = [
    ("Planet PlanetScope", "بصري 3 م · يومي · مراقبة مستمرة",
     PLANET[0], PLANET[1], PLANET[2]),
    ("Airbus Pléiades Neo", f"بصري 30 سم · تكليف موجَّه · {VHR_MIN_ORDER_KM2} كم²",
     VHR_USD_PER_KM2[0] * VHR_MIN_ORDER_KM2,
     VHR_USD_PER_KM2[1] * VHR_MIN_ORDER_KM2,
     "‎25–45 دولاراً/كم² فوق حدّ أدنى للطلب — لا نغطّي المدينة كاملة"),
    ("ICEYE / Capella SAR", "رادار · يخترق الغيم · لكل مشهد",
     SAR_SCENE[0], SAR_SCENE[1], SAR_SCENE[2]),
]


def money(usd):
    return usd, usd * SAR


def main() -> None:
    az_month = sum(x[2] for x in AZURE)
    az_year = az_month * 12
    az_year_reserved = az_year * (1 - RESERVED_SAVING * 0.62)   # DB+app ≈ 62%

    print("=" * 78)
    print("AZURE — البنية التحتية (ثقة عالية: من بطاقة الأسعار المنشورة)")
    print("=" * 78)
    print(f"{'البند':26}{'المواصفة':34}{'$/شهر':>8}")
    for name, spec, cost, _note in AZURE:
        print(f"  {name:24}{spec:34}{cost:8}")
    print(f"  {'المجموع':24}{'':34}{az_month:8}")
    print(f"\n  سنوياً  ${az_year:,}  =  {az_year*SAR:,.0f} ريال")
    print(f"  مع حجز سنة واحدة  ${az_year_reserved:,.0f}  "
          f"=  {az_year_reserved*SAR:,.0f} ريال")

    print("\n" + "=" * 78)
    print("الصور التجارية (تقديرية — ليست عروض أسعار)")
    print("=" * 78)
    for name, spec, lo, hi, basis in IMAGERY:
        print(f"  {name:22}{spec:36}")
        print(f"  {'':22}${lo:,} – ${hi:,}   ({lo*SAR:,.0f} – {hi*SAR:,.0f} ريال)")
        print(f"  {'':22}الأساس: {basis}")
    lo_l, hi_l, basis_l = LIDAR
    print(f"  {'LiDAR جوي':22}{'مسح لمرة واحدة · 545 كم²':36}")
    print(f"  {'':22}${lo_l*AOI_KM2:,} – ${hi_l*AOI_KM2:,}   "
          f"({lo_l*AOI_KM2*SAR:,.0f} – {hi_l*AOI_KM2*SAR:,.0f} ريال)")
    print(f"  {'':22}الأساس: {basis_l}")

    full_lo = VHR_USD_PER_KM2[0] * AOI_KM2
    full_hi = VHR_USD_PER_KM2[1] * AOI_KM2
    tgt_lo, tgt_hi = IMAGERY[1][2], IMAGERY[1][3]
    print(f"\n  التكليف الموجَّه مقابل تغطية المدينة كاملة، للمشهد الواحد:")
    print(f"    كامل الـ{AOI_KM2} كم²   ${full_lo:,} – ${full_hi:,}   "
          f"({full_lo*SAR:,.0f} – {full_hi*SAR:,.0f} ريال)")
    print(f"    موجَّه {VHR_MIN_ORDER_KM2} كم²     ${tgt_lo:,} – ${tgt_hi:,}   "
          f"({tgt_lo*SAR:,.0f} – {tgt_hi*SAR:,.0f} ريال)")
    print(f"    الفرق  {full_lo/tgt_lo:.1f}×  — وهذا ما تشتريه الطبقة المجانية")

    planet_lo, planet_hi = IMAGERY[0][2], IMAGERY[0][3]
    vhr_lo = IMAGERY[1][2] * VHR_EVENTS_PER_YEAR
    vhr_hi = IMAGERY[1][3] * VHR_EVENTS_PER_YEAR
    sar_lo = IMAGERY[2][2] * SAR_SCENES_PER_YEAR
    sar_hi = IMAGERY[2][3] * SAR_SCENES_PER_YEAR

    tiers = {
        "tier1": {"name": "البيانات المفتوحة فقط",
                  "lo": az_year_reserved, "hi": az_year,
                  "what": "المنصّة كما هي اليوم — لا صور تجارية إطلاقاً"},
        "tier2": {"name": "مع مراقبة بصرية يومية",
                  "lo": az_year_reserved + planet_lo,
                  "hi": az_year + planet_hi,
                  "what": "إضافة تدفّق Planet اليومي لكشف التغيّر"},
        "tier3": {"name": "مع تكليف عند الحدث",
                  "lo": az_year_reserved + planet_lo + vhr_lo + sar_lo,
                  "hi": az_year + planet_hi + vhr_hi + sar_hi,
                  "what": f"إضافة {VHR_EVENTS_PER_YEAR} تكليفات عالية الدقّة "
                          f"و{SAR_SCENES_PER_YEAR} مشاهد رادارية سنوياً"},
    }
    print("\n" + "=" * 78)
    print("الباقات — سنوياً")
    print("=" * 78)
    print(f"{'':2}{'الباقة':26}{'USD':>22}{'SAR':>26}")
    for k, v in tiers.items():
        print(f"  {v['name']:26}"
              f"${v['lo']:>9,.0f} – ${v['hi']:>9,.0f}"
              f"{v['lo']*SAR:>13,.0f} – {v['hi']*SAR:>10,.0f}")
    print(f"\n  LiDAR رأسمالي لمرة واحدة: "
          f"{lo_l*AOI_KM2*SAR:,.0f} – {hi_l*AOI_KM2*SAR:,.0f} ريال")

    t1 = tiers["tier1"]
    print("\n" + "-" * 78)
    print(f"الرقم الذي كان في العرض: 102,000 ريال سنوياً")
    print(f"الرقم المحسوب للباقة المفتوحة: "
          f"{t1['lo']*SAR:,.0f} – {t1['hi']*SAR:,.0f} ريال")
    print("أي أنّ التقدير القديم كان أعلى من الواقع بأربعة إلى ستة أضعاف —")
    print("لأنّ البنية التحتية وحدها رخيصة، والتكلفة الحقيقية في الصور التجارية.")

    OUT.write_text(json.dumps(
        {"sar_per_usd": SAR, "aoi_km2": AOI_KM2,
         "azure_monthly_usd": az_month, "azure_annual_usd": az_year,
         "azure_annual_usd_reserved": round(az_year_reserved),
         "azure_lines": [{"item": a, "spec": b, "usd_month": c} for a, b, c, _ in AZURE],
         "imagery": [{"vendor": a, "spec": b, "usd_lo": c, "usd_hi": d,
                      "basis": e} for a, b, c, d, e in IMAGERY],
         "lidar_one_off_usd": [lo_l * AOI_KM2, hi_l * AOI_KM2],
         "tiers": {k: {**v, "sar_lo": round(v["lo"] * SAR),
                       "sar_hi": round(v["hi"] * SAR)}
                   for k, v in tiers.items()},
         "confidence": {
             "azure": "high — published rate card, +/-15% on region and egress",
             "imagery": "indicative only — vendors price by negotiated contract"}},
        indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
