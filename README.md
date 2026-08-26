<div align="center">

# مَسارب · Masareb

**Satellite urban-water intelligence for Al Madinah Municipality**

One satellite time series. Two problems. Zero installed hardware.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/astral-fate/masareb)

</div>

---

## What this is

Al Madinah faces two water problems that look opposite and are physically identical:

| | المشكلة | What it costs |
|---|---|---|
| **الهَدْر** — waste | Parks and street trees are irrigated on fixed schedules. Excess water runs off onto the asphalt. | Desalinated water wasted, road base eroded, and it is already a municipal violation (fine up to **3,000 SAR**) — but detection today waits for a citizen report. |
| **الغَرَق** — ponding | Rainwater collects on specific street segments. | The Kingdom laid **454,000 linear metres** of drainage in 2024 alone, yet *where* to build is still driven by complaints, and **nothing independently measures whether what was built worked**. |

Both are *water sitting on an impervious surface where it should not be*. One question separates them:

> **هل أمطرت؟ — Did it rain?**

Water on asphalt **with** rain in the last 72 h → ponding (Module B).
Water on asphalt **without** rain → irrigation waste (Module A).

That single discriminator is why one pipeline yields two products. On the Madinah record only **2.3% of days are wet**, so the rainless gate is open almost always and Module A runs on nearly every satellite pass.

---

## Architecture

Vercel runs frontends and short serverless functions. It has **no writable filesystem**, **10–60 s function timeouts**, and **no background scheduler** — so it cannot run the satellite pipeline live.

It does not need to. Satellite revisit is 5 days, which makes this workload *inherently batch*. The pipeline precomputes; Vercel serves from the edge. That is faster than a live API would be, and it is the honest shape for the problem.

```
┌───────────────────────────────────────────────────────────────┐
│  packages/pipeline   Node CLI — runs locally, in Docker, or CI │
│                                                                │
│   OSM Overpass ──┐                                             │
│   Open-Meteo ────┼──▶ MongoDB ──▶ detectors ──▶ static export  │
│   Earth Engine ──┘    (Atlas)                        │         │
│     Sentinel-2/1                                     │         │
│     Copernicus DEM                                   ▼         │
│                                        apps/web/public/data/*  │
└──────────────────────────────────────────────────────┼─────────┘
                                                       │ git push
                                                       ▼
┌───────────────────────────────────────────────────────────────┐
│  apps/web   Next.js (React + route handlers)  ──▶  VERCEL      │
│             MapLibre GL · Arabic RTL · edge-cached JSON        │
└───────────────────────────────────────────────────────────────┘
```

**Stack:** MongoDB · Express-style Next.js route handlers · React (Next.js App Router) · Node 20.
Geometry is [Turf.js](https://turfjs.org) on WGS84 with metre units — geodesic, no projection step, so the CRS axis-order class of bug cannot occur.

---

## Quick start

```bash
git clone https://github.com/astral-fate/masareb
cd masareb
npm install
cp .env.example .env      # then fill in MONGODB_URI
```

### 1. Start MongoDB

```bash
docker run -d --name masareb-mongo -p 27017:27017 mongo:7
```

Or use a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster and set `MONGODB_URI`.

### 2. Check your environment

```bash
npm run pipeline -- doctor
```

Reports MongoDB connectivity, Earth Engine auth, and — importantly — **whether the Sentinel-1 archive has fallen behind Sentinel-2**. See [Known limitations](#known-limitations).

### 3. Build the data

```bash
npm run pipeline:units      # OSM → green assets, spill rings, street segments
npm run pipeline:weather    # Open-Meteo → 10 years of daily rain + rain events
npm run pipeline:s2         # Sentinel-2 index time series  (needs GEE key)
npm run pipeline:export     # → apps/web/public/data/*.json
```

Or all of it: `npm run pipeline:all`

Measured on the Al Madinah AOI:

| Layer | Count |
|---|---|
| Green assets | **324** |
| Spill rings | **320** |
| Street segments (~200 m) | **30,326** — 5,272 km of network |
| Daily rain records | **4,250** (2015 → 2026) |
| Rain events ≥ 5 mm | **30** |

### 4. Run the dashboard

```bash
npm run dev        # http://localhost:3000
```

---

## Earth Engine setup

Server-side Earth Engine needs a **service account**, not your personal login:

1. Google Cloud console → IAM → Service Accounts → **create**
2. Grant it **Earth Engine Resource Viewer**
3. Create a **JSON key** and download it
4. Register the service-account e-mail at [signup.earthengine.google.com/#!/service_accounts](https://signup.earthengine.google.com/#!/service_accounts)
5. Put the entire key JSON on one line in `GEE_SERVICE_ACCOUNT_KEY`

> **Licensing.** Earth Engine's free tier does not cover operational government use. Production deployment requires either an Earth Engine commercial licence, an approved Partner-tier application, or migration to the [Copernicus Data Space Ecosystem](https://dataspace.copernicus.eu). This is tracked as risk **R-01** in the BRD and is not a detail to discover later.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel link
vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard — every push to `main` deploys.

**Environment variables** to set in Vercel → Project Settings:

| Variable | Needed for |
|---|---|
| `MONGODB_URI` | live queries (optional — the app falls back to precomputed JSON) |
| `MONGODB_DB` | as above |

The satellite keys are **not** needed on Vercel: the pipeline runs elsewhere and commits its output. Keeping GEE credentials off the web host is deliberate.

### Keeping data fresh

The pipeline is batch, so refresh it on a schedule with GitHub Actions and let the resulting commit trigger a Vercel deploy. See `.github/workflows/pipeline.yml`.

---

## Repository layout

```
masareb/
├── apps/web/                 Next.js dashboard → deploys to Vercel
│   ├── app/                  App Router pages + route handlers
│   ├── components/           map, KPI cards, detail drawer
│   └── public/data/          precomputed JSON (tracked in git)
├── packages/pipeline/        Node batch pipeline
│   └── src/
│       ├── config.js         every threshold, in one auditable place
│       ├── db.js             MongoDB collections, indexes, run audit
│       ├── osm.js            Overpass ingestion
│       ├── units.js          green assets, spill rings, street segments
│       ├── weather.js        rain archive + the module discriminator
│       ├── gee.js            Earth Engine: indices, masking, zonal stats
│       ├── s2.js             Sentinel-2 backfill
│       └── export.js         static export for the web app
├── brd/                      Business Requirements Document (Arabic, 20 pp)
└── vercel.json
```

---

## How honesty is enforced in the schema

Remote-sensing products lie quietly by reporting a zero when they simply could not see. This one is built so that is structurally impossible.

- **`detectionStatus`** distinguishes `not_detected` from `sar_blind`, `cloud_blocked`, `missed_revisit`, and `no_dry_reference`. These are separate values and the API never collapses them.
- **`observationCoverage`** gates the risk band: if a segment was observable in under 30% of rain events, its band is forced to `insufficient_data` and **can never be `stable`**. A street we could not see is never reported as safe.
- **`opticalNativeScaleM`** records `20` on every MNDWI/NDMI/NDBI value, because those derive from B11/B8A which are 20 m native — not the 10 m the product might imply.
- **`dtmConfidence`**, **`sarVisibility`**, **`geometryConfidence`**, **`estimateConfidence`** travel with every record.
- Estimated volumes are always `{value, low, high, confidence, method}` — never a bare number.

---

## Known limitations

Stated here because they are design constraints, not bugs:

| Limitation | Consequence |
|---|---|
| Revisit is **days**; a flash flood lasts **hours** | The satellite is **not** a real-time flood alarm. It builds the susceptibility map and verifies after the event. The alarm is *weather forecast × that map*. This split is deliberate. |
| Sentinel-1 archive in Earth Engine may lag Sentinel-2 | Historical ponding and before/after verification still work; live radar verification may not. `pipeline doctor` checks and reports the gap. |
| Copernicus DEM is a **DSM**, not a DTM | Buildings and trees are in the elevation surface. Outputs are a *relative ranking*, never an absolute water level. |
| SAR in narrow streets | Water between buildings gets **brighter**, not darker — a flat surface plus a wall is a corner reflector. The detector picks the threshold sign by built fraction; shadow/layover areas are masked and shown as *not assessable*. |
| 10 m optical, 20 m for SWIR indices | Residential streets under ~10 m wide are mixed pixels and are flagged low confidence. |
| No ground-truth flood inventory | Labels are self-generated from the radar archive. Validation level is `satellite_only` until a field campaign runs. |

**What this platform does not do:** real-time flood alarms from orbit, centimetre water depths, or hydraulic design. It is a screening, targeting and verification layer — the engineer still designs, but starts at hour 20 instead of hour 0.

---

## Attribution

Reuses the Earth Engine authentication pattern, incremental-update discipline and adaptive per-site threshold logic from the team's earlier `palm-satellite-paper` pipeline, disclosed per hackathon originality rules. Everything else — the urban water domain, the spill-ring method, the ponding module, street segmentation, the recommendation engine, the MongoDB schema and the web application — is new.

Data: Copernicus Sentinel-1/2 and DEM (ESA) · Landsat (USGS/NASA) · [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL · [Open-Meteo](https://open-meteo.com), CC-BY · Al Madinah Municipality open data.

Built for **برمجان المنورة 2026** — المتابعة الذكية للخدمات track.

## License

MIT
