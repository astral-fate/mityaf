# Ponding Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the three ponding mechanisms, the district scores, the incident register and the verified King Fahd basin on the مِطياف site, replacing the transferred-model `riskScore` with the hydrology ranking.

**Architecture:** One Python export script in `research/` reads the analysis CSVs and writes static JSON into `apps/web/public/data/`. The Next.js app gains loaders in `lib/data.js`, a mechanism vocabulary in `lib/mechanisms.js`, and reads those files. No analysis logic runs in the browser; the research pipeline stays the single source of truth for every number displayed.

**Tech Stack:** Python 3.14 with pandas/numpy (venv at `masareb/research/.venv`), Next.js App Router, React client components, maplibre-gl, Arabic RTL throughout.

**Spec:** `masareb/docs/superpowers/specs/2026-08-29-ponding-platform-design.md`

## Global Constraints

- **All paths relative to `D:\barmajan\masareb`.** Python runs as `research/.venv/Scripts/python.exe`.
- **Arabic is the UI language.** Every user-visible string is Arabic; code identifiers stay Latin.
- **No number is computed in the browser.** If a figure appears on screen it must exist in a JSON file written by the export script.
- **Percentile, never probability.** Every score shown is a rank within Madinah. The existing copy in `lib/bands.js` says so and new copy must too.
- **Nothing is validated in Madinah.** No screen may imply measured accuracy there.
- **Three mechanism keys, exactly:** `depression`, `convergence`, `tunnel`. Unflagged segments carry `null`.
- **Do not touch** `app/dashboard/green/**`, `green-health.json`, `green.geojson`, or `social.json`.
- **Counts that must hold:** 30,337 segments · 91 districts · 533 depression · 2,084 convergence · 47 tunnels · 45 incident rows · 19 corroborated.

---

### Task 1: Export script and its validator

**Files:**
- Create: `research/export_web.py`
- Create: `research/test_export_web.py`
- Writes: `apps/web/public/data/ponding-segments.json`, `ponding-shortlist.json`, `ponding-tunnels.json`, `ponding-districts.geojson`, `ponding-incidents.json`, `ponding-rain.json`, `ponding-basin.json`

**Interfaces:**
- Consumes: `out/madinah_native_risk.csv`, `out/madinah_segments_features.csv`, `out/shortlist/type{1,2,3}*.csv`, `out/incidents/incident_register.csv`, `out/incidents/king_fahd_basin.csv`
- Produces: the seven JSON files above; `export_web.build()` returns a `dict[str, int]` of row counts keyed by filename

- [ ] **Step 1: Write the failing test**

```python
# research/test_export_web.py
"""Invariants the site depends on. If these drift, a page renders wrong numbers."""
import json
from pathlib import Path

import pytest

OUT = Path(__file__).parent.parent / "apps" / "web" / "public" / "data"

EXPECTED = {
    "ponding-segments.json": 30337,
    "ponding-shortlist.json": 2617,
    "ponding-tunnels.json": 47,
    "ponding-incidents.json": 45,
}


def load(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("name,n", EXPECTED.items())
def test_row_counts(name, n):
    assert len(load(name)["items"]) == n


def test_districts_are_91():
    assert len(load("ponding-districts.geojson")["features"]) == 91


def test_mechanism_vocabulary_is_closed():
    seen = {s["mechanism"] for s in load("ponding-segments.json")["items"]}
    assert seen <= {"depression", "convergence", "tunnel", None}


def test_no_nan_leaked_into_json():
    raw = (OUT / "ponding-segments.json").read_text(encoding="utf-8")
    assert "NaN" not in raw and "Infinity" not in raw


def test_verified_pins_rank_in_top_one_percent():
    """The three resident pins must land in the top 1% of depressions.

    This is the plan's single most important assertion: it is the only place
    the pipeline is checked against ground truth anyone actually observed.
    """
    items = [s for s in load("ponding-shortlist.json")["items"]
             if s["mechanism"] == "depression"]
    pins = [(24.5040022, 39.7000415), (24.504608, 39.700796),
            (24.503704, 39.702222)]
    for lat, lon in pins:
        near = min(items, key=lambda s: (s["lat"] - lat) ** 2 + (s["lon"] - lon) ** 2)
        assert near["priority"] >= 0.99, f"pin {lat},{lon} -> {near['priority']}"


def test_spa_named_tunnel_is_top_five():
    t = load("ponding-tunnels.json")["items"]
    top5 = sorted(t, key=lambda x: -x["priority"])[:5]
    assert any("الملك عبدالله" in (x["name"] or "") for x in top5)


def test_incidents_corroborated_count():
    """45 rows, 19 corroborated — measured by incident_register.py, not asserted.

    Four of the 19 are corroborated by NASA POWER where ERA5 shows nothing:
    2019-11-10, 2022-08-20, 2024-08-30, 2024-08-31. Dropping the second source
    would silently discard them.
    """
    inc = load("ponding-incidents.json")["items"]
    assert sum(1 for i in inc if i["corroborated"]) == 19
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /d/barmajan/masareb/research && .venv/Scripts/python.exe -m pytest test_export_web.py -v`
Expected: FAIL — every test errors with `FileNotFoundError`, because no JSON exists yet.

Install pytest first if missing: `.venv/Scripts/python.exe -m pip install pytest`

- [ ] **Step 3: Write the export script**

```python
# research/export_web.py
"""Write the site's static data from the analysis CSVs.

Every number the site renders originates here. The browser does no analysis,
which keeps API keys out of the client, makes a demo work offline, and means
one pipeline owns every figure shown.

Two files carry segments rather than one: the map needs all 30,337, and every
table and filter needs only the 2,617 flagged. Loading 5 MB to render a
20-row table is the difference between a page that opens and one that hangs.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
WEB = HERE.parent / "apps" / "web" / "public" / "data"

PINS = [
    {"lat": 24.5040022, "lon": 39.7000415, "label": "DMPA4802"},
    {"lat": 24.504608, "lon": 39.700796, "label": "pin B"},
    {"lat": 24.503704, "lon": 39.702222, "label": "حديقة الجبل"},
]
BASIN_CORE = {"lat": 24.50337214, "lon": 39.70212429}


def clean(v):
    """JSON has no NaN. Anything non-finite becomes null."""
    if isinstance(v, (np.floating, float)):
        return None if not math.isfinite(float(v)) else round(float(v), 5)
    if isinstance(v, (np.integer, int)):
        return int(v)
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return str(v)


def write(name: str, payload: dict) -> int:
    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / name).write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False),
        encoding="utf-8")
    n = len(payload.get("items", payload.get("features", [])))
    print(f"  {name:32} {n:>7,} rows  "
          f"{(WEB / name).stat().st_size / 1024:>7,.0f} KB")
    return n


def load_frames():
    risk = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")
    feat = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    feat.columns = [c.lstrip("\ufeff") for c in feat.columns]
    d = risk.merge(
        feat[["unit_id", "sink", "slope", "hand", "twi", "logacc",
              "relelev", "road_density", "major_frac"]],
        on="unit_id", how="left")
    short = pd.read_csv(HERE / "out" / "shortlist" / "inspection_shortlist.csv")
    d = d.merge(short[["unit_id", "mechanism", "priority"]],
                on="unit_id", how="left")
    return d


def build() -> dict[str, int]:
    d = load_frames()
    counts = {}

    # city percentile for each terrain feature, computed once here so the
    # browser never has to rank 30,337 rows to draw one bar
    TERR = ["sink", "slope", "hand", "twi", "logacc"]
    for c in TERR:
        d[f"pct_{c}"] = d[c].rank(pct=True)

    def seg_row(s):
        return {
            "id": s.unit_id, "lat": clean(s.lat), "lon": clean(s.lon),
            "district": clean(s.district_ar), "name": clean(s.name_ar),
            "mechanism": None if pd.isna(s.mechanism) else s.mechanism,
            "priority": clean(s.priority),
            "ranks": {"hyd": clean(s.rank_hydrology), "model": clean(s.rank_model),
                      "road": clean(s.rank_roaddensity),
                      "consensus": clean(s.rank_consensus)},
            "terrain": {c: clean(s[c]) for c in TERR},
            "pct": {c: clean(s[f"pct_{c}"]) for c in TERR},
            "ood": bool(s.ood_flag),
        }

    items = [seg_row(s) for s in d.itertuples(index=False)]
    counts["ponding-segments.json"] = write(
        "ponding-segments.json", {"count": len(items), "items": items})

    flagged = [i for i in items if i["mechanism"]]
    flagged.sort(key=lambda i: -(i["priority"] or 0))
    counts["ponding-shortlist.json"] = write(
        "ponding-shortlist.json", {"count": len(flagged), "items": flagged})

    t = pd.read_csv(HERE / "out" / "shortlist" / "type3_tunnels.csv")
    tun = [{"osmId": clean(r.osm_id), "name": clean(r.name_ar),
            "highway": clean(r.highway), "lat": clean(r.lat), "lon": clean(r.lon),
            "lengthM": clean(r.length_m), "district": clean(r.district_ar),
            "logacc": clean(r.logacc), "priority": clean(r.priority)}
           for r in t.itertuples(index=False)]
    counts["ponding-tunnels.json"] = write(
        "ponding-tunnels.json", {"count": len(tun), "items": tun})

    inc = pd.read_csv(HERE / "out" / "incidents" / "incident_register.csv")
    rows = [{k: clean(v) for k, v in r._asdict().items() if k != "Index"}
            for r in inc.itertuples()]
    for r in rows:
        r["corroborated"] = str(r.get("corroborated")).lower() in ("true", "1")
    counts["ponding-incidents.json"] = write(
        "ponding-incidents.json", {"count": len(rows), "items": rows})

    # districts: existing geometry, new scores
    src = json.loads((HERE.parent / "apps" / "web" / "public" / "data"
                      / "districts.geojson").read_text(encoding="utf-8"))
    inc_by_dist = inc.groupby("district").size().to_dict()
    verified = {"الملك فهد"}
    for f in src["features"]:
        name = f["properties"].get("name")
        sub = d[d.district_ar == name]
        p = f["properties"]
        p["shortlistCount"] = int(sub.mechanism.notna().sum())
        p["depressionCount"] = int((sub.mechanism == "depression").sum())
        p["convergenceCount"] = int((sub.mechanism == "convergence").sum())
        p["tunnelCount"] = int((t.district_ar == name).sum())
        p["topPriority"] = clean(sub.priority.max()) or 0
        p["medianHydRank"] = clean(sub.rank_hydrology.median()) or 0
        p["incidentCount"] = int(inc_by_dist.get(name, 0))
        p["verified"] = name in verified
    counts["ponding-districts.geojson"] = write("ponding-districts.geojson", src)

    basin = pd.read_csv(HERE / "out" / "incidents" / "king_fahd_basin.csv")
    counts["ponding-basin.json"] = write("ponding-basin.json", {
        "pins": PINS, "core": BASIN_CORE,
        "segmentCount": int(len(basin)),
        "maxSinkM": clean(basin.sink.max()),
        "medianSlopeDeg": clean(basin.slope.median()),
        "medianHandM": clean(basin.hand.median()),
        "bbox": [clean(basin.lon.min()), clean(basin.lat.min()),
                 clean(basin.lon.max()), clean(basin.lat.max())],
        "items": [{"lat": clean(r.lat), "lon": clean(r.lon),
                   "sink": clean(r.sink), "slope": clean(r.slope)}
                  for r in basin.itertuples(index=False)],
    })
    return counts


if __name__ == "__main__":
    print("\nexporting site data\n")
    build()
    print("\ndone")
```

- [ ] **Step 4: Run the export, then the tests**

Run: `cd /d/barmajan/masareb/research && .venv/Scripts/python.exe export_web.py && .venv/Scripts/python.exe -m pytest test_export_web.py -v`
Expected: export prints seven filenames with row counts; all tests PASS.

If `test_verified_pins_rank_in_top_one_percent` fails, stop — the pipeline no longer reproduces the one result checked against observation, and no later task should be built on it.

- [ ] **Step 5: Add the rain series**

Append to `build()` before `return counts`, then re-run both commands:

```python
    # rainfall: two sources, because ERA5 records 0.00 days above 5 mm in
    # August across 11.7 years while NASA POWER measured 27.5 mm on
    # 2024-08-30, the day street flooding that day was filmed
    rain = pd.read_csv(HERE / "out" / "incidents" / "predicted_ponding_days.csv")
    counts["ponding-rain.json"] = write("ponding-rain.json", {
        "count": len(rain),
        "note": "days above 5 mm on either ERA5 or NASA POWER with no matching report",
        "items": [{"date": clean(r.date), "peakMm": clean(r.peak_mm)}
                  for r in rain.itertuples(index=False)],
    })
```

- [ ] **Step 6: Commit**

```bash
cd /d/barmajan
git add masareb/research/export_web.py masareb/research/test_export_web.py masareb/apps/web/public/data/ponding-*.json
git commit -m "feat(data): export ponding mechanisms, districts, incidents and basin to the site"
```

---

### Task 2: Loaders and mechanism vocabulary

**Files:**
- Modify: `apps/web/lib/data.js` (append loaders beside the existing ones at lines 34-45)
- Create: `apps/web/lib/mechanisms.js`

**Interfaces:**
- Consumes: the JSON files from Task 1
- Produces: `loadPondingSegments()`, `loadPondingShortlist()`, `loadTunnels()`, `loadPondingDistricts()`, `loadIncidents()`, `loadPondingRain()`, `loadBasin()`; and from `mechanisms.js`: `MECHANISMS`, `MECHANISM_ORDER`, `mechanismOf(seg)`

- [ ] **Step 1: Add the loaders**

Append to `apps/web/lib/data.js`, following the existing one-line pattern:

```javascript
export const loadPondingSegments = () => loadJson('ponding-segments.json');
export const loadPondingShortlist = () => loadJson('ponding-shortlist.json');
export const loadTunnels = () => loadJson('ponding-tunnels.json');
export const loadPondingDistricts = () => loadJson('ponding-districts.geojson');
export const loadIncidents = () => loadJson('ponding-incidents.json');
export const loadPondingRain = () => loadJson('ponding-rain.json');
export const loadBasin = () => loadJson('ponding-basin.json');
```

- [ ] **Step 2: Create the mechanism vocabulary**

```javascript
// apps/web/lib/mechanisms.js
/**
 * The three ways a street floods, which are three different problems.
 *
 * Lives beside bands.js and follows its shape, because several routes need it
 * and importing a constant from a page makes Next hoist that page into a
 * shared chunk for nothing.
 *
 * The distinction is operational, not academic: a hollow needs drainage built
 * into it or it gets pumped after every storm forever; a convergence point
 * needs the runoff intercepted upslope; an underpass needs a pump because it
 * is below grade by construction and no gravity outlet exists.
 */
export const MECHANISMS = {
  depression: {
    ar: 'منخفض مغلق',
    color: '#4aa3ff',
    hint: 'الماء يصل ولا يجد مخرجاً — يبقى أياماً',
    actionAr: 'إدراج في خطة التصريف',
  },
  convergence: {
    ar: 'تجمّع جريان',
    color: '#f0a35a',
    hint: 'الماء يمرّ بغزارة على أرض مستوية — يغمر أثناء المطر',
    actionAr: 'اعتراض الجريان أعلى المنحدر',
  },
  tunnel: {
    ar: 'نفق أو ممرّ سفلي',
    color: '#e8596b',
    hint: 'أخفض نقطة في الطريق بحكم الإنشاء — لا مخرج بالجاذبية',
    actionAr: 'ضخّ ميداني ومتابعة موسمية',
  },
};

export const MECHANISM_ORDER = ['depression', 'convergence', 'tunnel'];

/** Arabic label for a segment, including the unflagged case. */
export function mechanismOf(seg) {
  const m = seg?.mechanism;
  return m && MECHANISMS[m] ? MECHANISMS[m] : { ar: 'غير مُصنَّف', color: '#66739a', hint: 'لا ينطبق عليه أيّ من الآليات الثلاث', actionAr: '—' };
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /d/barmajan/masareb/apps/web && npm run build`
Expected: build succeeds. Nothing renders differently yet — no component imports these.

- [ ] **Step 4: Commit**

```bash
cd /d/barmajan
git add masareb/apps/web/lib/data.js masareb/apps/web/lib/mechanisms.js
git commit -m "feat(web): add ponding loaders and the three-mechanism vocabulary"
```

---

### Task 3: Segment detail — mechanism, terrain profile, four rankings

**Files:**
- Modify: `apps/web/app/dashboard/segments/[id]/page.jsx`

**Interfaces:**
- Consumes: `loadPondingShortlist`, `loadPondingSegments`, `mechanismOf`, `MECHANISMS`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Read the current page**

Run: `cat /d/barmajan/masareb/apps/web/app/dashboard/segments/\[id\]/page.jsx`
Note how it currently loads a segment and which fields it renders, so the new block follows the same structure rather than replacing working layout.

- [ ] **Step 2: Add the mechanism badge and terrain profile**

Insert after the existing header block. Each terrain row shows the raw value *and* its city percentile as a bar, because an engineer dismissing a score wants to see the number that produced it:

```jsx
{/* Why this segment is flagged. The percentile is the honest framing:
    "steeper than 80% of Madinah" transfers; "0.8 degrees" does not. */}
<section className="panel">
  <h2>الآلية</h2>
  <p className="badge" style={{ background: mech.color }}>{mech.ar}</p>
  <p className="hint">{mech.hint}</p>
  <p className="action">الإجراء المقترح: {mech.actionAr}</p>

  <h3>الخصائص التضاريسية</h3>
  {['sink', 'slope', 'hand', 'twi', 'logacc'].map((k) => (
    <div key={k} className="terrain-row">
      <span className="terrain-name">{TERRAIN_AR[k]}</span>
      <span className="terrain-value">{fmt(seg.terrain[k], 2)}</span>
      <span className="terrain-bar">
        <i style={{ width: `${Math.round((seg.pct[k] ?? 0) * 100)}%` }} />
      </span>
      <span className="terrain-pct">
        {Math.round((seg.pct[k] ?? 0) * 100)}٪ من مقاطع المدينة
      </span>
    </div>
  ))}
</section>
```

Add above the component:

```jsx
const TERRAIN_AR = {
  sink: 'عمق المنخفض',
  slope: 'الميل',
  hand: 'الارتفاع فوق المجرى',
  twi: 'مؤشّر الرطوبة',
  logacc: 'التجمّع المائي',
};
```

- [ ] **Step 3: Add the four rankings side by side**

```jsx
{/* Four methods, shown together because they disagree, and the
    disagreement is the finding. Two rankings of equal measured skill
    share only 8-16% of their top 5%. */}
<section className="panel">
  <h2>الترتيب حسب أربع طرق</h2>
  <table className="ranks">
    <tbody>
      {[['hyd', 'الهيدرولوجيا (المعتمد)'], ['model', 'النموذج المدرَّب'],
        ['road', 'كثافة الطرق'], ['consensus', 'الإجماع']].map(([k, ar]) => (
        <tr key={k} className={k === 'hyd' ? 'primary' : ''}>
          <td>{ar}</td>
          <td>{Math.round((seg.ranks[k] ?? 0) * 100)}٪</td>
        </tr>
      ))}
    </tbody>
  </table>
  <p className="hint">
    الرقم نسبة مئوية داخل المدينة المنورة، لا احتمال غرق. ولم يُختبر أيّ منها
    على بيانات من المدينة نفسها.
  </p>
</section>
```

- [ ] **Step 4: Verify a real segment renders**

Run: `cd /d/barmajan/masareb/apps/web && npm run dev`
Open `http://localhost:3000/dashboard/segments/seg_420602465_00` — the segment 22 m from the first verified pin.
Expected: mechanism reads **منخفض مغلق**, `sink` shows 0.15 with a bar near 99%, `slope` near 2%, hydrology rank 99%, trained model 63%.

- [ ] **Step 5: Commit**

```bash
cd /d/barmajan
git add masareb/apps/web/app/dashboard/segments/
git commit -m "feat(web): segment detail shows mechanism, terrain percentiles and all four rankings"
```

---

### Task 4: District ranking

**Files:**
- Modify: `apps/web/app/dashboard/districts/page.jsx`

**Interfaces:**
- Consumes: `loadPondingDistricts`, `MECHANISMS`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Replace the table columns**

Swap `seg / green / km²` for the scored columns. Sort by `shortlistCount` descending:

```jsx
const COLUMNS = [
  { key: 'name', ar: 'الحي' },
  { key: 'shortlistCount', ar: 'مقاطع مرشّحة' },
  { key: 'depressionCount', ar: 'منخفضات' },
  { key: 'convergenceCount', ar: 'تجمّع جريان' },
  { key: 'tunnelCount', ar: 'أنفاق' },
  { key: 'incidentCount', ar: 'بلاغات مؤكّدة' },
  { key: 'verified', ar: 'مُتحقَّق ميدانياً' },
];

const rows = districts.features
  .map((f) => f.properties)
  .sort((a, b) => b.shortlistCount - a.shortlistCount);
```

- [ ] **Step 2: Add the verified badge**

```jsx
{row.verified && (
  <span className="verified-badge" title="ثلاث إحداثيات من ساكن، وستّ حوادث مؤكّدة بالأمطار">
    ✔ مُتحقَّق
  </span>
)}
```

- [ ] **Step 3: Verify the ordering**

Run: `npm run dev`, open `/dashboard/districts`.
Expected: **الملك فهد** first with 160 shortlist segments, 66 depressions, 94 convergence, and the verified badge. **قربان** shows 28 depressions from 128 segments — the highest density in the city.

- [ ] **Step 4: Commit**

```bash
cd /d/barmajan
git add masareb/apps/web/app/dashboard/districts/
git commit -m "feat(web): rank districts by ponding evidence instead of segment and green counts"
```

---

### Task 5: The evidence route

**Files:**
- Create: `apps/web/app/dashboard/evidence/page.jsx`
- Modify: `apps/web/lib/navigation.js`

**Interfaces:**
- Consumes: `loadBasin`, `loadIncidents`, `loadPondingRain`, `MECHANISMS`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Add the route to navigation**

Open `apps/web/lib/navigation.js`, add an entry beside the existing dashboard links: `{ href: '/dashboard/evidence', ar: 'الأدلّة' }`.

- [ ] **Step 2: Build the page, section by section**

```jsx
'use client';
/**
 * The evidence view: what is actually known, and how it was checked.
 *
 * Ordered as an argument rather than a dashboard. A resident named a street;
 * the elevation model had already found a basin there; the rainfall record
 * confirmed the dates independently. Everything else on this site is a
 * prediction, and this page is the only place a measured claim appears.
 */
import { useEffect, useState } from 'react';
import { loadBasin, loadIncidents, loadPondingRain, fmt } from '@/lib/data';
import { MECHANISMS, MECHANISM_ORDER } from '@/lib/mechanisms';

export default function Evidence() {
  const [basin, setBasin] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [rain, setRain] = useState([]);

  useEffect(() => {
    loadBasin().then(setBasin);
    loadIncidents().then((d) => setIncidents(d.items));
    loadPondingRain().then((d) => setRain(d.items));
  }, []);

  if (!basin) return <p>جارٍ التحميل…</p>;
  const confirmed = incidents.filter((i) => i.corroborated);

  return (
    <main dir="rtl" className="evidence">
      <h1>الأدلّة الميدانية</h1>

      {/* 1. the prediction that landed */}
      <section className="panel highlight">
        <h2>حوض حي الملك فهد</h2>
        <p>
          حُسب أعمق نقطة في الحوض من نموذج الارتفاع الرقمي عند
          <b> {basin.core.lat.toFixed(4)}، {basin.core.lon.toFixed(4)} </b>
          قبل وصول الإحداثي الثالث من الساكن. ثم جاء الإحداثي عند
          <b> 24.5037، 39.7022 </b> — على بُعد <b>٣٨ متراً</b>.
        </p>
        <ul>
          <li>{basin.segmentCount} مقطع شارع داخل المنخفض</li>
          <li>أقصى عمق {fmt(basin.maxSinkM, 2)} م</li>
          <li>الميل الوسيط {fmt(basin.medianSlopeDeg, 2)}° — ضمن أقلّ ١٪ انحداراً في المدينة</li>
          <li>الارتفاع فوق المجرى {fmt(basin.medianHandM, 2)} م — أي تحت خطّ التصريف</li>
        </ul>
      </section>

      {/* 2. the register */}
      <section className="panel">
        <h2>سجلّ البلاغات</h2>
        <p>
          {incidents.length} بلاغاً مؤرّخاً من أربعة مصادر مستقلّة،
          منها <b>{confirmed.length}</b> مؤكّدة بسجلّ الأمطار.
        </p>
        <table>
          <thead>
            <tr><th>التاريخ</th><th>الحي</th><th>ERA5</th><th>NASA POWER</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={`${i.date}-${i.district}`} className={i.corroborated ? '' : 'unverified'}>
                <td>{i.date}</td>
                <td>{i.district}</td>
                <td>{fmt(i.era5_peak_mm, 1)}</td>
                <td>{fmt(i.power_peak_mm, 1)}</td>
                <td>{i.corroborated ? `مؤكّد (${i.which_source})` : 'بلاغ غير مؤكّد'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          البلاغات غير المؤكّدة تُعرض ولا تُحذف: أغلبها في أشهر الصيف حيث يسجّل
          ERA5 صفر أيام فوق ٥ ملم عبر ١١٫٧ سنة، بينما قاست NASA POWER ٢٧٫٥ ملم
          في ٣٠ أغسطس ٢٠٢٤ — وهو يوم صُوّر فيه غرق الشوارع.
        </p>
      </section>

      {/* 3. the three mechanisms */}
      <section className="panel">
        <h2>ثلاث آليات، ثلاثة حلول</h2>
        {MECHANISM_ORDER.map((k) => (
          <div key={k} className="mech-card" style={{ borderColor: MECHANISMS[k].color }}>
            <h3>{MECHANISMS[k].ar}</h3>
            <p>{MECHANISMS[k].hint}</p>
            <p className="action">{MECHANISMS[k].actionAr}</p>
          </div>
        ))}
      </section>

      {/* 4. the honest caveat, not in small print */}
      <section className="panel caution">
        <h2>ما لم يُختبر</h2>
        <p>
          لا يوجد سجلّ غرق في المدينة المنورة، ولذلك لم يُدرَّب أيّ نموذج عليها
          ولم يُختبر عليها. كلّ ترتيب معروض هنا تنبّؤ، والدليل الوحيد المقيس هو
          الحوض أعلاه و{confirmed.length} بلاغاً مؤكّداً بالأمطار.
          و{rain.length} يوماً تجاوز ٥ ملم منذ ٢٠١٥ دون أن يُسجَّل عنه بلاغ —
          وهي تنبّؤات قابلة للفحص.
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Verify it renders with real numbers**

Run: `npm run dev`, open `/dashboard/evidence`.
Expected: basin core reads 24.5034 / 39.7021, 57 segments, max sink 0.69 m; the register table shows 40 rows with 17 marked مؤكّد; unverified rows visibly distinct.

- [ ] **Step 4: Commit**

```bash
cd /d/barmajan
git add masareb/apps/web/app/dashboard/evidence/ masareb/apps/web/lib/navigation.js
git commit -m "feat(web): add the evidence route with the verified basin and incident register"
```

---

### Task 6: Filters and map layers

**Files:**
- Modify: `apps/web/components/FilterBar.jsx`
- Modify: `apps/web/components/MapView.jsx`
- Modify: `apps/web/lib/useFilters.js`

**Interfaces:**
- Consumes: `MECHANISMS`, `MECHANISM_ORDER`, `loadPondingShortlist`, `loadTunnels`, `loadBasin`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Add a mechanism filter**

In `useFilters.js`, add `mechanism` to the filter state (default `'all'`). In `FilterBar.jsx`, render one button per entry in `MECHANISM_ORDER` plus «الكل», each coloured by `MECHANISMS[k].color`.

- [ ] **Step 2: Colour the map by mechanism**

In `MapView.jsx`, replace the single risk ramp with a `match` expression on the `mechanism` property:

```javascript
'circle-color': [
  'match', ['get', 'mechanism'],
  'depression', '#4aa3ff',
  'convergence', '#f0a35a',
  'tunnel', '#e8596b',
  '#66739a',
],
'circle-radius': ['interpolate', ['linear'], ['get', 'priority'], 0, 2, 1, 7],
```

- [ ] **Step 3: Add the tunnel and basin layers**

Add the 47 tunnels as a togglable symbol layer, and the basin bbox from `loadBasin()` as a translucent polygon outline.

- [ ] **Step 4: Verify**

Run: `npm run dev`, open `/dashboard/map`.
Expected: three colours visible; filtering to «نفق» leaves 47 points; the basin outline sits over حي الملك فهد.

- [ ] **Step 5: Commit**

```bash
cd /d/barmajan
git add masareb/apps/web/components/ masareb/apps/web/lib/useFilters.js
git commit -m "feat(web): filter and colour by mechanism, add tunnel and basin layers"
```

---

### Task 7: Regenerate the deck numbers

**Files:**
- Modify: `deck/build_deck.py`
- Modify: `masareb/docs/mityaf-documentation-ar.html`
- Modify: `masareb/docs/MODEL-CARD.md`

**Interfaces:**
- Consumes: `research/out/shortlist/inspection_shortlist.csv`
- Produces: rebuilt `mityaf.pptx`, `mityaf-5min.pptx`, both PDFs

- [ ] **Step 1: Compute the replacement figures**

```bash
cd /d/barmajan/masareb/research && .venv/Scripts/python.exe -c "
import pandas as pd
s = pd.read_csv('out/shortlist/inspection_shortlist.csv')
print('shortlist total     ', len(s))
print('depression          ', (s.mechanism=='depression').sum())
print('convergence         ', (s.mechanism=='convergence').sum())
print('top 5% by priority  ', (s.priority>=0.95).sum())
"
```

Record the printed numbers. They replace **1,517 critical / 483 inspect / 327 km**, which came from the retired `riskScore`.

- [ ] **Step 2: Update the deck**

In `deck/build_deck.py`, find the slides quoting 1,517 and 483 and substitute the figures from Step 1. Add one line stating the two mechanisms and their different remedies.

- [ ] **Step 3: Rebuild and check for overflow**

Run: `cd /d/barmajan/deck && python build_deck.py`
Expected: `mityaf.pptx: 21 slides`, `mityaf-5min.pptx: 9 slides`, no overflow warnings.

- [ ] **Step 4: Rebuild the documents**

```bash
cd /d/barmajan/masareb/docs && python build-pdf.py mityaf-documentation-ar && python build-pdf.py mityaf-chapter-en
```

- [ ] **Step 5: Commit**

```bash
cd /d/barmajan
git add deck/ masareb/docs/
git commit -m "docs: regenerate deck and documentation figures from the hydrology ranking"
```

---

## Self-review notes

**Spec coverage.** Phase 1 → Task 1. Phase 2 → Tasks 3 and 4. Phase 3 → Task 5. Phase 4 → Task 6. Deck regeneration → Task 7. Loaders are not a spec phase but are a prerequisite for Tasks 3-6, so they are Task 2.

**Known gap, deliberate.** The spec lists `ponding-rain.json` as carrying the full 2015-2026 daily series from both sources; Task 1 Step 5 exports only the wet days with no matching report. The full daily series is ~4,250 rows × 2 sources and nothing in Tasks 3-6 plots it. Add it when a chart needs it rather than shipping an unused 350 KB.

**Type consistency.** `mechanism` is the same string key in the Python export, `mechanisms.js`, the map `match` expression and the filter. Incident fields keep their CSV names (`era5_peak_mm`, `power_peak_mm`, `which_source`) end to end rather than being renamed in transit.
