# Masareb — Technical Dossier

**An end-to-end explanation of the problem, the prior art, the alternatives, and what we built.**

Written in plain English. No prior remote-sensing knowledge assumed.

---

## Table of contents

1. [What this is, in one page](#1-what-this-is-in-one-page)
2. [The problem](#2-the-problem)
3. [Why it has not already been solved](#3-why-it-has-not-already-been-solved)
4. [Literature review and prior art](#4-literature-review-and-prior-art)
5. [The data landscape](#5-the-data-landscape)
6. [How you could build this — six approaches compared](#6-how-you-could-build-this--six-approaches-compared)
7. [Our method](#7-our-method)
8. [System architecture](#8-system-architecture)
9. [Honest pros and cons](#9-honest-pros-and-cons)
10. [How we would know it works](#10-how-we-would-know-it-works)
11. [What exists today vs what is next](#11-what-exists-today-vs-what-is-next)
12. [Glossary](#12-glossary)
13. [References](#13-references)

---

## 1. What this is, in one page

Al Madinah Municipality has two water problems that look like opposites:

- **Too much water in the wrong place, on a dry day.** Parks and street trees are watered on fixed schedules. The excess runs off onto the road, wasting desalinated water and eroding the asphalt from underneath.
- **Too much water in the wrong place, on a wet day.** Rain collects on particular street segments. The city builds drainage to fix this, but decides *where* to build largely from complaints.

Physically, these are the same event: **water sitting on an impervious surface where it should not be.** A satellite cannot tell them apart from a single image — wet asphalt looks like wet asphalt.

But one question separates them completely:

> **Did it rain in the last 72 hours?**

- Wet asphalt **with** recent rain → drainage problem.
- Wet asphalt **without** recent rain → irrigation problem.

That single test is the whole idea. It means **one satellite pipeline produces two operational products**, which is why this is one platform and not two.

There is a second, quieter idea that matters just as much. The Sentinel-1 radar satellite has been imaging Earth since 2014 and its archive is free. Every drainage project the municipality has completed since then already has a "before" and an "after" sitting in that archive — **nobody has ever queried it.** So the same system that finds problems can also grade the fixes, independently of the contractor's own report.

---

## 2. The problem

### 2.1 Problem one — water that is wasted

Irrigation of public green space in Saudi cities is typically scheduled, not sensed. A controller opens a valve for N minutes, M times a week, regardless of whether the soil is already saturated, whether it rained yesterday, or whether a sprinkler head has broken.

When over-application happens, the surplus does not stay in the soil. It sheets off the planted area onto whatever is adjacent — usually asphalt or interlock paving. That causes three costs:

1. **The water itself.** Saudi Arabia's municipal water is largely desalinated: energy-intensive and expensive. Losing it to a gutter is a pure loss.
2. **The road.** Water that repeatedly reaches the sub-base beneath asphalt softens it. The surface then fails prematurely — potholes, rutting, edge break. The road budget pays for an irrigation fault.
3. **The inspection cost.** Because there is no monitoring, crews find these faults by driving around, or not at all.

There is also a compliance dimension. The Ministry of Municipalities and Housing together with the Saudi Water Authority classify water flowing beyond a property boundary as a municipal violation and visual pollution, with a fine of **up to 3,000 SAR** where it floods a road. But enforcement depends on somebody noticing and reporting through the Balady+ app or the 940 line. Detection is reactive by construction.

### 2.2 Problem two — water that is trapped

Saudi Arabia is building stormwater drainage at scale. Verified figures from the Ministry of Municipalities and Housing:

| Metric | Value |
|---|---|
| Drainage laid in 2024 | **454,000 linear metres** |
| Drainage laid in 2023 | **291,000 linear metres** |
| Cumulative total | **over 8,000,000 linear metres** |
| Critical rain-accumulation sites | fell from **600+ (2022)** to **under 300 (2025)** |

That is a serious, well-funded programme with real results. Two gaps remain:

**Gap one — targeting.** Deciding which street gets drainage next is driven by complaint history and institutional memory. Complaints are biased towards areas where people complain, not necessarily where water actually collects; and towards the last storm rather than the pattern across a decade.

**Gap two — verification.** After a project is commissioned, no independent instrument measures whether ponding actually reduced. The evidence is the contractor's completion report and the absence of new complaints. Absence of complaints is not absence of flooding.

This gap is officially acknowledged. The Ministry's innovation platform carries an open challenge, **CH33**: *"Insufficient stormwater drainage network coverage increases the frequency of water accumulation."* Notably, all three solutions the Ministry itself proposes are **hardware** — rapid-deploy modular drainage, permeable paving, and smart sensors at critical points. Each of them raises the same prior question: **where do you put it?**

### 2.3 The Madinah context

Specific, verified facts that shape the design:

- **Operational scale.** During a rain event the municipality mobilises **over 5,500 staff and 1,000 vehicles** across more than **900 km²**. Where they stage matters enormously, and today it is decided by judgement.
- **Rain is rare and concentrated.** From our own ingested archive (Open-Meteo, 4,250 days, 2015–2026): only **2.3% of days** have measurable rain, and there have been just **30 rain events of 5 mm or more in eleven years**. The largest was 65.6 mm in January 2023.
- **Existing smart-city investment.** Madinah ranks **74th globally and 7th in the Arab world** on the IMD Smart City Index (2024). It runs an IoT sensor programme across a 15-million-tree planting initiative, autonomous drones for detecting visual deterioration, and air-quality sensors.
- **A specific, citable project.** The "horizontal drilling" (الثقب الأفقي) scheme connecting the Al-Mudhaynab culvert to the Al-Mahzour district: **1,700 linear metres, pipe diameters up to 3,000 mm** — laid without open-cutting the road.

> **A correction we made during this work.** Press coverage described "historic floods" in Madinah in August 2024, and we initially cited it. When we ingested the actual rainfall archive, it showed **no measurable rain at the city centroid that month**. The likely explanation is a localised convective cell that a ~9 km reanalysis grid smooths away, or wadi flow originating outside the city. Either way, the claim was not supported by our own data, so we removed it. This is recorded here because it illustrates the standard the rest of the document is held to.

### 2.4 Why the two problems belong in one system

Beyond the shared physics, they share infrastructure:

- The same satellites, the same revisit schedule, the same download.
- The same spatial units (you need to know where the parks and streets are for both).
- The same weather feed — which is precisely what separates them.
- The same dashboard, the same field crews, the same municipality.

Building them separately would mean paying for the pipeline twice.

---

## 3. Why it has not already been solved

Five genuine difficulties, each of which shapes our design.

### 3.1 Resolution

Free satellite imagery is 10 m per pixel at best (Sentinel-2's visible and near-infrared bands). A residential street 6 m wide does not occupy even one pixel — the pixel is a blend of road, kerb, wall and shadow. You cannot reliably see a puddle on a small street from orbit.

*Consequence:* the honest unit of analysis is not a pixel but a **street segment** or a **park**, and small residential streets carry low confidence by default.

### 3.2 Revisit versus event duration

Sentinel-2 passes every ~5 days. Sentinel-1 every 6–12 days depending on orbit coverage. A flash flood in an arid city peaks and drains in **hours**.

The satellite will essentially never photograph the peak. Anyone claiming real-time satellite flood alerting for a city like Madinah is overstating.

*Consequence:* the satellite's job is **not** the alarm. Its job is to build the map of *which places are prone*, and to verify *after* the event. The alarm comes from weather forecasting multiplied by that map. We return to this in §7.

### 3.3 Radar behaves counter-intuitively in cities

Radar is the tool that sees through cloud and at night, which matters because rain comes with cloud. Over open ground, water is a mirror: it reflects the radar pulse away, so water looks **dark**.

Between buildings, the opposite happens. A flat water surface next to a vertical wall forms a **corner reflector** — the double-bounce effect — sending a strong signal straight back. Flooded urban streets often appear **brighter**, not darker.

A detector built on "dark equals water" therefore misses precisely the streets that matter most. Radar also suffers **layover and shadow** near tall buildings, creating permanently unobservable zones.

*Consequence:* the sign of the detection threshold must be chosen by local built density, and blind zones must be masked and declared, not silently scored.

### 3.4 The elevation model includes the buildings

Free global elevation data (Copernicus DEM GLO-30) is a **Digital Surface Model** — the top of whatever is there, including rooftops and tree canopy. It is not a bare-earth model.

If you route water flow across it naively, storm runoff politely flows over rooftops.

*Consequence:* buildings must be masked and the surface interpolated beneath them, and street centrelines "burned" into the terrain — because in a paved city, water actually follows the kerbed street channel, not the natural ground surface. The result is an approximation, and its confidence must be carried per cell.

### 3.5 There is no ground truth

There is no dataset saying "this street flooded on this date". Nobody surveys ponding during a storm — it is dangerous and expensive. Supervised machine learning needs labels, and there are none.

*Consequence:* either you build an unsupervised model, or you generate labels from the radar archive itself. We do both, and we are explicit about which claims rest on which.

---

## 4. Literature review and prior art

### 4.1 The terrain school — flood susceptibility mapping

The oldest and most robust body of work asks: *from the shape of the land, which places are likely to collect water?* It requires no flood observations at all, which is why it dominates in data-poor regions.

Standard predictors:

| Predictor | Meaning in plain English |
|---|---|
| **Slope** | Flat ground drains slowly |
| **TWI** (Topographic Wetness Index) | Combines "how much land drains into here" with "how flat is here". High TWI = water gathers |
| **HAND** (Height Above Nearest Drainage) | How high you are above the nearest natural channel. Low HAND = close to the water's natural level |
| **Flow accumulation** | How much upslope area drains through this cell |
| **Sink depth** | How deep a closed depression is — the most direct "puddle" predictor |
| **Imperviousness** | Paved surfaces produce far more runoff than soil |
| **Distance to drainage** | Far from an inlet means water has nowhere to go |

These are combined either by expert weighting — commonly **AHP (Analytic Hierarchy Process)**, which converts pairwise expert judgements into weights and reports a consistency ratio — or by statistical methods such as frequency ratio, or by machine learning where labels exist.

There is a substantial Saudi-specific literature applying exactly this: flash flood hazard mapping in southwestern Saudi Arabia, Wadi Nu'man near Makkah, Najran, and the Wadi Qows catchment in Jeddah, typically combining SRTM elevation, Landsat land cover and satellite rainfall through GIS multi-criteria analysis.

**What it gives us:** a defensible ranking that works from day one with no flood observations, and whose weights a municipal engineer can inspect and adjust.

**What it does not give:** any evidence that water *actually* appeared. It is a statement about propensity, not observation.

**A methodological trap worth naming.** Terrain predictors are strongly spatially autocorrelated — adjacent segments share slope, catchment and imperviousness. If you train a model and validate it with ordinary random k-fold cross-validation, neighbouring segments land in both training and test sets and the model scores beautifully while having learned nothing generalisable. Validation must be **spatially blocked** (hold out whole districts or grid blocks). This error is common in published flood-susceptibility papers.

### 4.2 The observation school — SAR flood detection

The second body of work asks: *where was water actually visible?* Synthetic Aperture Radar is the instrument of choice because it penetrates cloud and works at night — essential, since floods arrive with weather.

The canonical method is **change detection**: compare radar backscatter during the event against a dry reference from the same satellite track, and flag large drops. Thresholds around −3 dB are common for open water.

Key findings from the literature:

- **Urban flood mapping with SAR is materially harder than rural**, and is under-served in the literature. The complication is exactly the double-bounce and shadow behaviour described in §3.3.
- **UrbanSARFloods** (CVPR 2024 EarthVision workshop) is a benchmark dataset built specifically to address this gap, combining Sentinel-1 intensity, InSAR coherence and phase across polarisations.
- **DeepSAR Flood Mapper** demonstrates global flood mapping on Google Earth Engine using an MLP over Sentinel-1 plus **HAND** — notable because it fuses the observation and terrain schools.
- Comparative studies benchmark pixel classification, object-based analysis and instance segmentation, using Random Forest, SVM, U-Net, DeepLabV3 and Mask R-CNN.
- **Orbit matching is non-negotiable.** Radar backscatter depends on incidence angle and look direction, so a value from one satellite track is not comparable with another. Every comparison must stay within a single relative orbit and pass direction.
- **Speckle filtering must be done in linear power, not decibels.** Averaging decibels averages logarithms and biases the result.

**What it gives us:** actual evidence, and — critically — a way to manufacture labels retrospectively from an archive going back to 2014.

**What it does not give:** depth, timing precision finer than the revisit, or any coverage in radar-blind zones.

### 4.3 Irrigation and vegetation monitoring

A third body of work uses optical satellite indices to monitor vegetation water status:

| Index | Formula | What it indicates |
|---|---|---|
| **NDVI** | (NIR − Red)/(NIR + Red) | Vegetation vigour. Irrigated land typically > 0.4 |
| **NDWI** (McFeeters) | (Green − NIR)/(Green + NIR) | Open surface water |
| **MNDWI** | (Green − SWIR)/(Green + SWIR) | Open water, far better at rejecting built-up surfaces |
| **NDMI** | (NIR − SWIR)/(NIR + SWIR) | Moisture in the vegetation canopy |
| **NDBI** | (SWIR − NIR)/(SWIR + NIR) | Built-up / impervious surface |

Findings relevant to us:

- NDMI can reveal **uneven irrigation, blocked emitters, and over- or under-watered zones** across a field, detecting stress before it is visible to the eye.
- Work on **urban parks** specifically has used Sentinel-2 NDVI with a relative-water-supply indicator to assess irrigation performance and support park managers' scheduling decisions.
- **Thermal** approaches use Landsat's thermal band to estimate land surface temperature and hence evapotranspiration. Evaporating surfaces are cooler than their surroundings, so an anomalously cool park is a candidate for over-watering. Resolution is coarse (100 m native, delivered at 30 m), so it is only usable on assets larger than about a hectare.
- **Multispectral leak detection** literature applies related logic to buried pipe leaks.

**What it gives us:** a credible basis for detecting over-irrigation.

**The gap we found:** this literature consistently measures *inside* the vegetated area. But a wet park is genuinely ambiguous — it may simply be well managed. What is *not* ambiguous is **water on the pavement immediately outside the park on a day with no rain**. We could not find prior work that makes the adjacent impervious ring the primary observable. That is the specific contribution of our Module A (§7.3).

### 4.4 Operational systems that already exist

| System | What it does | Why it does not close this gap |
|---|---|---|
| **Google Flood Hub** | Riverine flood forecasting at national scale using hydrological models | Forecasts *river* flooding. Urban pluvial ponding on a specific street is a different phenomenon at a different scale |
| **Copernicus Emergency Management Service** | Rapid satellite mapping after major disasters | Activated per-disaster for large events; not a continuous municipal monitoring service |
| **Global Flood Monitoring (GFM)** | Continuous Sentinel-1 flood extent, Copernicus | Global product, tuned for large open-area floods; not street-segment resolution or urban-tuned |
| **Commercial SAR flood services** (e.g. Floodbase / Cloud to Street) | Near-real-time flood extent, largely for insurance and disaster response | Commercial, event-focused, and oriented to extent rather than municipal asset targeting |
| **MoMaH platforms — Ajwaa, Emerge, Flow Map** | Real-time weather and incident monitoring for Saudi municipalities | Weather and reports. Not satellite-derived terrain susceptibility, and no retrospective project verification |
| **Madinah IoT tree sensors** | Per-tree moisture, temperature, GPS across the 15M tree programme | Covers newly planted trees only, at a hardware cost per unit. Says nothing about existing mature assets, streets, or asphalt |
| **Madinah inspection drones** | Autonomous detection of visual deterioration | Different phenomenon; limited area per flight |
| **Balady+ / 940 citizen reports** | Public reporting channel | Genuinely valuable ground truth, but reactive: it captures what somebody saw and chose to report |

### 4.5 The gap, stated precisely

Each strand above is mature. What we could not find is a system that:

1. runs **continuously over an entire city**, not per-disaster;
2. treats **irrigation waste and stormwater ponding as one problem** discriminated by rainfall;
3. uses the **adjacent impervious ring** as the primary evidence of irrigation runoff;
4. produces a **ranked, actionable list tied to the municipality's own construction vocabulary**;
5. and uses the **free radar archive to retrospectively grade completed drainage projects**.

Point 5 is, as far as we can determine, unexploited. The data has existed since 2014 and costs nothing.

---

## 5. The data landscape

Everything below is free and open. That is a deliberate design constraint: the marginal cost of monitoring one more park must be zero, or the system does not scale to a whole city.

| Source | Resolution | Revisit | What we use it for |
|---|---|---|---|
| **Sentinel-2** (optical) | 10 m (20 m for shortwave-infrared bands) | ~5 days | NDVI, NDWI, MNDWI, NDMI, NDBI — vegetation and surface water |
| **Sentinel-1** (radar) | ~10 m | 6–12 days | Water detection through cloud and at night; the historical archive back to 2014 |
| **Copernicus DEM GLO-30** | 30 m | static | Slope, flow accumulation, TWI, HAND, depressions |
| **Landsat 8/9 thermal** | 100 m (delivered 30 m) | ~8 days combined | Land surface temperature → evaporative cooling anomaly |
| **Open-Meteo** | point | hourly + forecast | **The rainfall discriminator** and the early-warning trigger |
| **GPM IMERG** | 0.1° (~11 km) | 30 min | Storm timing and intensity across the city |
| **OpenStreetMap** | vector | continuous | Street network, parks, wadis, districts |
| **Dynamic World / WorldCover / Open Buildings** | 10 m | continuous | Impervious fraction, building mask |
| **Al Madinah open data** | aggregate | annual | Drainage quantities built — context and economics |

Three limitations must be recorded in the system itself, not just mentioned:

- **MNDWI, NDMI and NDBI derive from 20 m bands**, not 10 m. Nothing resamples that away. Each observation records its true native scale.
- **GPM IMERG at 11 km covers Madinah in about 4–6 pixels.** It gives storm timing and a coarse gradient, never neighbourhood detail.
- **The Al Madinah open drainage dataset is an aggregate summary table**, not geolocated project records. We verified this by downloading it: the 2024 file is 1.6 KB of totals (21,812 m of primary network, 19,433 m of secondary, 22 box culverts). It is excellent for economics and credibility, and useless for spatial verification. Project locations must come from published descriptions or from the municipality's GIS directly.

---

## 6. How you could build this — six approaches compared

Satellites are not the only option. Here is the honest comparison.

### Option A — IoT sensor network

Install water-level and soil-moisture sensors at critical points.

- **Pros:** continuous, real-time, unambiguous, measures actual depth.
- **Cons:** cost scales linearly with coverage; requires power, connectivity and maintenance; vulnerable to theft and vandalism (the Ministry has a separate open challenge about signage theft for exactly this reason); and fundamentally you must **already know where to put them.**
- **Verdict:** excellent as a *confirmation* layer on the top 20–50 locations. Not a discovery mechanism.

### Option B — Drone survey

Fly UAVs to photograph conditions.

- **Pros:** very high resolution, flexible, on demand.
- **Cons:** small area per flight; requires pilots and airspace permissions (non-trivial near the Prophet's Mosque); cannot fly safely during the storm you care about; no historical archive.
- **Verdict:** good for detailed inspection of a known site. Cannot cover 900 km² continuously.

### Option C — Full hydraulic modelling (SWMM / HEC-RAS 2D)

Build a physics-based model of the drainage network and simulate storms.

- **Pros:** the engineering gold standard; predicts depth, flow rate and system capacity; produces designs, not just rankings.
- **Cons:** requires as-built drainage GIS, high-resolution bare-earth LiDAR, and calibration data. Expensive, slow, and needs specialist staff. Critically, it models the network **as designed**, so it cannot tell you that an inlet is blocked today.
- **Verdict:** the right tool for *designing* the fix. Our system's job is to decide *which 30 of 30,000 segments deserve that investment*, and to check afterwards whether reality matched the design.

### Option D — CCTV and computer vision

Use existing traffic cameras with a flood-detection model.

- **Pros:** infrastructure partly exists; real-time; visually convincing evidence.
- **Cons:** cameras point where cameras were installed, which is not where flooding necessarily occurs; night and heavy rain degrade imagery; integration with municipal camera systems is a governance project in itself; no history.
- **Verdict:** a strong complement in a mature deployment, not a starting point.

### Option E — Crowdsourced reporting

Lean on Balady+ and 940.

- **Pros:** already exists; zero infrastructure cost; genuine ground truth; builds civic engagement.
- **Cons:** reactive by definition; biased towards where people are and where people complain; unusable for prevention; nothing at all for the last decade's history.
- **Verdict:** invaluable as **validation labels**, which is exactly how we plan to use it.

### Option F — Free satellite archive (what we built)

- **Pros:** zero hardware; entire city at once; ~zero marginal cost per additional asset; **works retrospectively back to 2015**, so it delivers a decade of history on day one; instantly portable to any other municipality; nothing to steal or maintain.
- **Cons:** 10–30 m resolution; revisit measured in days; radar blind spots in dense urban fabric; no depth measurement; no ground truth without a field campaign.
- **Verdict:** the only option that can *discover* problems across a whole city continuously. Its weaknesses are precisely covered by the strengths of A, C and E — which is why the roadmap adds them rather than replacing this.

### Summary

| | Discovers city-wide | Continuous | Historical | Measures depth | Marginal cost per site |
|---|---|---|---|---|---|
| IoT sensors | ✗ | ✓ | ✗ | ✓ | High |
| Drones | ✗ | ✗ | ✗ | ✗ | Medium |
| Hydraulic model | Partly | ✗ | ✗ | ✓ | Very high |
| CCTV + CV | ✗ | ✓ | ✗ | ✗ | Medium |
| Crowdsourcing | Partly | ✓ | ✗ | ✗ | ~Zero |
| **Satellite (ours)** | **✓** | **✓** | **✓** | **✗** | **~Zero** |

The honest reading: **no single approach wins.** Ours is the one that answers *where to look*, which is the question every other approach needs answered before it can start.

---

## 7. Our method

### 7.1 The discriminator

Everything rests on one join. Each satellite observation is tagged with the rainfall context for its date:

- `rain72hMm` — total rainfall over the preceding 72 hours
- `daysSinceRain` — days since the last day with measurable rain

Then:

```
if rain72hMm >= 1.0            -> "wet"          -> Module B territory
else if daysSinceRain < 3      -> "recent_rain"  -> ambiguous; judge nothing
else                           -> "rainless"     -> Module A territory
```

The middle state matters. For a few days after rain, wet pavement is genuinely ambiguous, so the system **declines to judge**. Refusing to answer is a feature.

Because only 2.3% of days in Madinah are wet, the rainless gate is open almost always — Module A can run on nearly every satellite pass.

### 7.2 Units of analysis

We never analyse raw pixels. We analyse things a municipality can act on:

| Unit | How it is derived | Count (real, Madinah) |
|---|---|---|
| **Green asset** | OSM parks, gardens, pitches and grass; filtered to 200 m²–20 ha | **324** |
| **Spill ring** | A band from 2 m to 20 m outside each green asset, with neighbouring greens subtracted | **320** |
| **Street segment** | OSM centrelines cut into ~200 m pieces | **30,326** (5,272 km) |
| **Micro-catchment** | Derived from the elevation model's flow routing | pending terrain build |

Two design choices worth explaining:

**Why the ring starts at 2 m, not 0.** The pixel straddling the grass edge is a blend of grass and pavement; including it would contaminate every reading. Starting 2 m out sacrifices a little coverage for a clean signal.

**Why segments are ~200 m.** A whole street can run for kilometres and mix a flood-prone dip with dry high ground, so a whole-street verdict is useless. 200 m is short enough to be a specific work order and long enough to contain several 10 m pixels.

Rings smaller than 1,000 m² — under roughly ten satellite pixels — are flagged `ringTooSmall` and cannot support a claim.

### 7.3 Module A — detecting irrigation waste

For each green asset on each cloud-free pass, **only when the rainless gate is open**:

1. Compute moisture and water indices inside the green polygon (NDMI, MNDWI).
2. Compute the water index **on the spill ring** — the adjacent pavement. *This is the discriminating evidence.*
3. Compare each against **that asset's own baseline**, not a global constant.
4. Score, requiring persistence across passes before confirming.

**Why per-site baselines.** A desert-edge park and an intensively irrigated central garden have completely different normal readings. A single global threshold either drowns you in false positives on one or misses everything on the other. The rule is "this site has departed from its own normal behaviour", implemented as a rolling standard deviation over a 12-week window. *(Note: the reference implementation we ported this from had a subtle bug — the first three weeks produced `NaN` thresholds that silently failed every comparison. Our port guards against it.)*

**Why the ring dominates the score.** A wet park is ambiguous. **Wet asphalt beside a park on a rainless day is not.** That is water leaving the asset — precisely the phenomenon the municipality wants stopped, and precisely the 3,000 SAR violation.

**A free operational bonus.** Scheduled over-irrigation and a broken pipe look different over time: irrigation is periodic and stops off-season; a leak is persistent and continues regardless. Classifying the signature routes the ticket to the right department — parks maintenance versus water utility.

**Volume estimates are always bounded.** Excess water is reported as `{value, low, high, confidence, method}` — never a bare number. The system detects and ranks; it does not meter. Claiming litres you cannot measure is how you lose a technical audience.

### 7.4 Module B — detecting and predicting ponding

Three strands.

**(a) Retrospective detection — which builds the labels.**

For each historical rain event, take the Sentinel-1 scene before and the first scene after, **on the same orbital track**, and compare backscatter. The threshold sign is chosen by local built density:

- Open areas: a drop of −3 dB or more suggests water (the mirror effect).
- Dense built areas: a rise of +2.5 dB or more suggests water (the corner-reflector effect).
- In between, or in radar-blind zones: **`ambiguous` / `sar_blind`**, never a score.

Running this over the whole archive turns eleven years of free imagery into a ponding history per street — **the label problem solved without a single field visit.**

**(b) Susceptibility index — which works from day one.**

Terrain and land-cover predictors (§4.1) combined with AHP weights, which are transparent and adjustable by a municipal engineer. This gives a complete city ranking immediately, with no observations required.

**(c) The forecast product — which is the operationally useful one.**

```
risk(segment, t+h) = susceptibility(segment) × f(forecast rainfall at t+h)
```

Because susceptibility is static and rainfall forecast comes from weather models, **this has no satellite revisit constraint at all.** It is available every single day.

**This is the crucial reframing.** The satellite's revisit limitation looks fatal until you notice that the highest-value moment is **T−48 hours**, not during the storm. Telling a municipality that mobilises 5,500 staff *where to stage them two days out* — from terrain, imperviousness, drainage gaps and eleven years of observed history — is worth more than an image taken mid-storm would be.

There is a second reframing worth stating. Water that drains in two hours is weather. **Water still standing 48 hours later is a defect** — a blocked outfall, no outlet, a reverse grade. The satellite's cadence is blind to the transient and perfectly matched to the chronic. The system detects **chronic drainage defects**, not storms. Framed that way, the "weakness" *is* the product definition.

### 7.5 From ranking to recommendation

A ranking alone does not spend a budget. Each high-risk segment gets a recommendation drawn from the municipality's **actual construction vocabulary** — box culverts, primary and secondary networks, horizontal drilling, channels, retaining walls, permeable paving, inlets, network cleaning.

Every recommendation carries three things, always visible:

- **Evidence** — the real numbers: catchment area, impervious fraction, distance to the nearest known drain, observed ponding history.
- **Assumptions** — runoff coefficients, design rainfall intensity, inlet capacity. Screening-level, and labelled as such.
- **`requiresHydraulicEngineer`** — a badge, not a footnote.

The single highest-return rule is not a construction project at all: *drainage exists within 100 m, yet ponding was observed repeatedly* → **inspect for blockage.** That costs a cleaning truck, not a capital scheme.

**The boundary we do not cross.** The system says "this 400 m segment receives runoff from 2.1 ha of impervious catchment with no inlet within 340 m; the nearest outfall is Wadi Al-Aqiq, 610 m along the flow path". It does **not** say "install a 900 mm pipe at 0.4% grade". The engineer still designs — but starts at hour 20 rather than hour 0.

### 7.6 Before/after verification

The feature we believe is genuinely unexploited.

1. Take a completed drainage project and its commissioning date.
2. Define its zone of influence.
3. Find every rain event with radar coverage of that zone, split before and after commissioning.
4. **Match on rainfall magnitude** — comparing a 5 mm storm before against a 40 mm storm after proves nothing.
5. Compare observed ponding frequency and extent, ideally against similar untreated control segments.
6. Report a verdict: *effective / partially improved / no effect observed / inconclusive*.

Two things make this credible:

- **The honest denominator.** Never "6 events" — always "**6 of 19 observed, from 23 total; 4 unobservable (3 radar-blind, 1 missed revisit)**".
- **"Inconclusive" is a permitted, respectable answer.** A project completed 14 months ago whose ponding signature is statistically unchanged is arguably the most valuable finding the system can produce.

---

## 8. System architecture

### 8.1 Why batch, not live

Satellite revisit is 5 days. Nothing in this system needs to run per-request. That single fact drives the whole architecture:

- **The pipeline is batch.** It runs on a schedule, writes results to a database, and exports static JSON.
- **The web app is read-only.** It serves precomputed data from a CDN edge.

This is not a compromise for the hosting platform — it is the correct shape. Serving precomputed JSON from an edge cache is *faster* than a live API querying a database would be, and it keeps satellite credentials entirely off the public web host.

### 8.2 The stack

Node end to end, so the whole thing deploys on standard web infrastructure.

```
┌────────────────────────────────────────────────────────────────┐
│  packages/pipeline — Node CLI (local, Docker, or CI)           │
│                                                                 │
│   OSM Overpass ──┐                                              │
│   Open-Meteo ────┼──▶ MongoDB ──▶ detectors ──▶ static export   │
│   Earth Engine ──┘    (Atlas)                        │          │
│     Sentinel-2/1, DEM                                ▼          │
│                                        apps/web/public/data/*   │
└──────────────────────────────────────────────────────┼──────────┘
                                                       │  git push
                                                       ▼
┌────────────────────────────────────────────────────────────────┐
│  apps/web — Next.js (React) · MapLibre GL · Arabic RTL         │
│             deployed to Vercel, JSON served from the edge      │
└────────────────────────────────────────────────────────────────┘
```

| Layer | Choice | Why |
|---|---|---|
| Satellite processing | **Google Earth Engine** via the official `@google/earthengine` Node client | Petabyte archive with server-side compute; nothing is downloaded |
| Database | **MongoDB** with 2dsphere indexes | Native GeoJSON storage and geospatial queries; free tier is ample |
| Geometry | **Turf.js** | Works in WGS84 with metre units directly — geodesic, no projection step |
| Map | **MapLibre GL** | WebGL: renders 30,000 line segments with a data-driven colour expression. DOM-based libraries collapse at this scale |
| Frontend | **Next.js / React** | Arabic RTL, edge caching, standard deployment |

**A note on geometry that is not incidental.** The earlier prototype used a database projection function to convert to metres. That function honoured the EPSG:4326 authority axis order (latitude, longitude) by default, silently swapping coordinates — a 0.01° latitude step measured 875 m instead of the true 1,109 m. Every buffer and distance in the system would have been about 20% wrong, with no error and no warning. Turf.js takes metres directly on WGS84, which removes the entire class of bug rather than fixing one instance of it.

### 8.3 The data model, and how honesty is enforced

Remote-sensing products lie quietly. The characteristic failure is reporting zero when the instrument simply could not see. This schema makes that structurally impossible.

| Field | What it prevents |
|---|---|
| **`detectionStatus`** | Separates `not_detected` from `sar_blind`, `cloud_blocked`, `missed_revisit`, `no_dry_reference`. These are distinct values and are never collapsed |
| **`observationCoverage`** | If a segment was observable in under 30% of rain events, its band is **forced** to `insufficient_data` and can never be `stable`. A street we could not see is never reported as safe |
| **`opticalNativeScaleM`** | Records `20` on every MNDWI/NDMI/NDBI value, because those come from 20 m bands regardless of what the product might imply |
| **`dtmConfidence`** | Marks cells where the elevation surface was interpolated beneath a masked building |
| **`sarVisibility`** | Marks permanently radar-blind zones; the map greys them out |
| **`estimateConfidence`** | Every modelled quantity carries `{value, low, high, confidence, method}` |
| **`pipelineRuns`** | Append-only audit: every job records coverage, rows written, and errors |

This is the part of the design we would defend most strongly. Anyone can build a dashboard that shows green where it has no data.

### 8.4 Deployment topology

```
Developer / CI  ──run pipeline──▶  MongoDB Atlas
                                        │
                                        └──export──▶ public/data/*.json
                                                          │
                                                     git push
                                                          │
                                                          ▼
                                                   Vercel (edge CDN)
```

The web host holds no credentials and runs no satellite code. The pipeline can run anywhere with Node and network access — a laptop, a container, or scheduled CI.

---

## 9. Honest pros and cons

### What is genuinely strong

1. **Zero hardware.** Nothing to install, power, maintain or steal. Marginal cost of the 325th park is zero.
2. **A decade of history on day one.** Not "start collecting and check back in a year" — the archive is already there.
3. **One pipeline, two products.** The rainfall discriminator is a genuine multiplier on the same infrastructure.
4. **Independent verification.** The before/after capability is, as far as we can tell, unexploited, and it directly addresses a real institutional blind spot.
5. **Immediately portable.** Change a bounding box and it runs on any other municipality.
6. **Resolves a national tension.** Saudi Arabia is planting billions of trees in a desert while targeting a 43% cut in per-capita water use. Without an irrigation-efficiency layer those goals collide.
7. **Honesty is structural.** The uncertainty handling is in the schema, not the marketing copy.

### What is genuinely weak

1. **Resolution.** 10 m optical, 20 m for the shortwave indices, 30 m terrain. Narrow residential streets are mixed pixels and are flagged low confidence.
2. **Revisit.** Days, not hours. Not a real-time alarm and never will be.
3. **Radar blind spots.** Layover and shadow near tall buildings create permanently unobservable areas. We mask and declare them, but we cannot see into them.
4. **No depth.** Neither radar amplitude nor optical indices measure how deep water is.
5. **Volume estimates are proxies.** Bounded and labelled, but not measurements.
6. **No ground truth yet.** Validation is currently `satellite_only`. This is the honest weak point until a field campaign runs.
7. **Rain is rare.** Only 30 events of 5 mm or more since 2015. That is a small sample for a supervised model, and it constrains how strong the statistical claims can be. It is also why the unsupervised index carries the load.
8. **Drainage network locations are not public.** "Distance to nearest drain" is one of the strongest predictors, and we cannot populate it properly without the municipality's GIS.
9. **Earth Engine licensing.** The free tier does not cover operational government use. Production requires a commercial licence, an approved partner-tier application, or migration to the Copernicus Data Space Ecosystem. This is a real dependency, not a footnote.

### What we explicitly do not claim

- Real-time flood alarms from orbit.
- Centimetre water depths.
- A substitute for hydraulic design modelling.
- Reliable assessment of narrow residential streets.
- Any judgement at all in radar-blind zones.

---

## 10. How we would know it works

Validation without ground truth is the hardest honest question. Our answer is a ladder, and every claim in the system carries the level it has reached.

| Level | Method | Available |
|---|---|---|
| **L0 — Internal consistency** | Do detections sit in low-HAND, high-TWI cells? Does ponding extent scale with rainfall magnitude? | Now |
| **L1 — Physical plausibility** | Do detections cluster on the real wadis (Al-Aqiq, Buthan, Qanat)? Do underpasses rank at the top? | Now |
| **L2 — Agreement with municipal action** | Do our top-ranked segments coincide with where the municipality *actually built drainage* in 2023–24, far above chance? | Now, and free |
| **L3 — Citizen reports** | Balady+ / 940 flood complaints as independent labels | Pilot |
| **L4 — Field campaign** | 30–50 sites visited by municipal crews with a five-field form | Pilot |
| **L5 — IoT sensors** | Continuous level sensors at the top-ranked points | Production |

**L2 deserves emphasis.** It is a real, quantifiable, no-cost validation available immediately. If an independent satellite-and-terrain ranking agrees with where a municipality independently chose to spend money, that is meaningful evidence. And where they *disagree*, those disagreements are the most interesting output the system can produce — either we are wrong, or they found something we should look at.

---

## 11. What exists today vs what is next

### Built and running on real data

| Component | Status |
|---|---|
| Repository, Node stack, deployment config | ✅ |
| MongoDB schema with honesty constraints | ✅ |
| OSM ingestion → **324 green assets, 320 spill rings, 30,326 street segments (5,272 km)** | ✅ real |
| Rainfall archive → **4,250 days, 30 rain events (2015–2026)** | ✅ real |
| The rainfall discriminator | ✅ |
| Earth Engine module: indices, cloud masking, chunked zonal statistics, orbit-matched radar | ✅ code complete |
| Static export → Next.js dashboard, Arabic RTL, MapLibre | ✅ |
| Business Requirements Document (20 pp, 46 functional requirements) | ✅ |

### Blocked on one credential

The Sentinel-2 backfill, terrain derivation and both detectors are written but need an **Earth Engine service-account key**. Until then, every street segment correctly renders as `insufficient_data` — which is the honesty design working, not a gap.

### Roadmap

| Phase | Scope |
|---|---|
| **1 — Now** | Pilot area, both modules, recommendations, before/after verification, alerts |
| **2 — Pilot (4 weeks)** | Full city; supervised model with spatially blocked validation; **field campaign for real labels**; Balady+ integration; Arabic reporting |
| **3 — Production** | In-Kingdom hosting; migration off Earth Engine licensing; role-based access; work-order integration; IoT confirmation layer at top-ranked sites; optional high-resolution tasking |

---

## 12. Glossary

| Term | Plain English |
|---|---|
| **NDVI** | Vegetation health index. High = green and growing |
| **NDWI / MNDWI** | Surface water indices. MNDWI is better in cities because it uses shortwave infrared |
| **NDMI** | Moisture held in plant canopy |
| **NDBI** | Built-up surface index — a proxy for paved area |
| **SAR** | Radar imaging. Sees through cloud, works at night |
| **Backscatter** | How much radar energy bounces back. Measured in decibels |
| **Double-bounce** | Water beside a wall reflects radar strongly, making flooded streets *brighter* not darker |
| **Layover / shadow** | Radar blind spots created by tall buildings |
| **TWI** | Topographic Wetness Index — how much this spot tends to collect water |
| **HAND** | Height Above Nearest Drainage — how high you sit above the nearest natural channel |
| **DSM / DTM** | Surface model (includes buildings and trees) versus bare-earth model |
| **Flow accumulation** | How much upslope land drains through a point |
| **Spill ring** | Our term: the band of pavement just outside a green area, where irrigation runoff appears |
| **AHP** | A method for turning expert judgements into transparent, auditable weights |
| **Box culvert** | A rectangular concrete channel carrying water under a road |
| **Horizontal drilling** | Laying pipe under a road without digging it open |

---

## 13. References

**Standards and methods**

- Beven & Kirkby — Topographic Wetness Index, the basis of terrain-driven wetness prediction
- Nobre et al. — HAND (Height Above Nearest Drainage) as a terrain descriptor for flood modelling
- McFeeters (1996) — NDWI; Xu (2006) — MNDWI; Zha et al. (2003) — NDBI; Feyisa et al. (2014) — AWEI
- Saaty — Analytic Hierarchy Process
- FAO-56 — reference evapotranspiration

**Flood detection and susceptibility**

- *UrbanSARFloods: Sentinel-1 SLC-Based Benchmark Dataset for Urban and Open-Area Flood Mapping* — CVPR 2024 EarthVision workshop
- *DeepSAR Flood Mapper* — global flood mapping on Google Earth Engine using MLP over Sentinel-1 and HAND
- *Towards Large-Scale Urban Flood Mapping Using Sentinel-1 Data* — IEEE
- Flash flood hazard mapping using remote sensing and GIS in southwestern Saudi Arabia — MDPI *Sustainability*
- Flood risk assessment, Wadi Nu'man basin; Wadi Qows, Jeddah; Najran flash flood mapping
- Analysis of the 2009 and 2011 Jeddah flash floods using multi-sensor remote sensing and GIS

**Vegetation, irrigation and thermal**

- Remote-sensing assessment of irrigation performance in urban parks using Sentinel-2 NDVI
- NDMI for detecting uneven irrigation, blocked emitters and over-watered zones
- Landsat thermal imagery for evapotranspiration monitoring and water-resource management — NASA
- Remote-sensing-based evapotranspiration modelling for urban green spaces (Vienna case study)
- Multispectral optical remote sensing for water-leak detection

**Data sources**

- Copernicus Sentinel-1 SAR GRD, Sentinel-2 MSI Level-2A, DEM GLO-30 — ESA / European Commission
- Landsat 8/9 Collection 2 Level-2 — USGS / NASA
- GPM IMERG V07 — NASA
- Google Dynamic World; ESA WorldCover v200; Google Open Buildings v3
- OpenStreetMap contributors (ODbL); Open-Meteo (CC-BY)

**Institutional**

- Ministry of Municipalities and Housing — stormwater drainage programme statistics; innovation challenge **CH33**
- Ministry of Municipalities and Housing with the Saudi Water Authority — water-flow violation and penalty framework
- Al Madinah Municipality — open data, smart city programme, horizontal drilling project
- Saudi National Water Strategy 2030; Saudi Green Initiative
- IMD Smart City Index 2024

---

*Masareb — built for برمجان المنورة 2026, المتابعة الذكية للخدمات track.*
