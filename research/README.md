# Feature validation on labelled data

Madinah has no flood inventory — nobody surveys ponding during a storm, so there
is nothing to train or test against. This folder closes that gap by validating
the **same feature engineering** on a city that *does* have continuous ground
truth, then carrying the model form across.

## The dataset

**NYC 311, descriptor `Street Flooding (SJ)`** — defined by the city as
*"flooding or ponding on a street"*, which is precisely our Module B phenomenon.

| | |
|---|---|
| Geocoded complaints | **21,287** |
| Period | 2020 – 2026, continuous |
| Source | `data.cityofnewyork.us/resource/erm2-nwe9` (open Socrata API, no key) |

Related descriptors in the same feed, also relevant and not yet used:

| Descriptor | Count |
|---|---|
| Catch Basin Clogged/Flooding | 44,572 |
| Manhole Overflow | 6,250 |
| Culvert Blocked | 3,778 |

The first of those is directly our *"drainage exists but underperforms"* case —
the highest-return recommendation rule in the whole system.

Complaints skew hard by borough: Queens 8,169 · Brooklyn 6,744 · Staten Island
3,117 · Bronx 1,757 · **Manhattan only 1,465**. The literature attributes this to
Manhattan's combined sewer versus the separate systems elsewhere — a reminder
that drainage *design*, not just terrain, drives the outcome.

## Other datasets considered

| Dataset | What it is | Why not primary here |
|---|---|---|
| **Sen1Floods11** | 4,831 Sentinel-1/2 chips, 11 flood events, 446 expert hand-labelled | Riverine/open-area water, not street ponding |
| **UrbanSARFloods** (CVPR 2024) | 8,879 chips, 18 events, urban, adds InSAR coherence | The right benchmark for the **SAR detector**, not for terrain susceptibility |
| Copernicus EMS | Rapid-mapping flood delineations | Per-disaster activations, not continuous |

Sen1Floods11 and UrbanSARFloods are the correct training sets for Module B's
*detector*. NYC 311 is the correct training set for its *susceptibility ranking*.
They answer different questions.

## Features

All derived from free global sources, so every one of them can be recomputed for
Madinah unchanged.

| Feature | Source | Meaning |
|---|---|---|
| `slope` | Copernicus DEM 30 m | flat ground drains slowly |
| `twi` | derived | how strongly a spot tends to collect water |
| `sink` | priority-flood | depth of a closed depression — the literal puddle |
| `hand` | derived | height above the local drainage line |
| `logacc` | D8 accumulation | upslope area draining through here |
| `relelev` | DEM − local mean | local low spot or high spot |
| `road_density` | OSM, km/km² | proxy for impervious surface |
| `major_frac` | OSM | share of road length that is arterial |
| `load_per_road` | derived | upslope load ÷ road length — *load per unit drainage* |

DEM comes from the **public Copernicus S3 bucket**, which needs no credentials:
`https://copernicus-dem-30m.s3.amazonaws.com/...`

## Two methodological choices that matter more than the model

**Negatives must carry road.** Complaints are presence-only. Draw negatives from
anywhere and the classifier learns *"a road exists here"* — parks, water and rail
yards have neither roads nor complaints and separate trivially, producing a
flattering, useless score. Negatives come only from cells with >50 m of road, so
the model must explain why *one street* floods and *another street* does not.

**Folds must be whole spatial blocks.** Terrain predictors are strongly spatially
autocorrelated; ordinary k-fold puts neighbouring cells in train and test at
once. This is the most common fatal error in published flood-susceptibility work.
We report both numbers, because the gap between them is itself the finding.

## Results

25,022 road-bearing cells at 200 m, 27.4% positive.

| | PR-AUC | ROC-AUC |
|---|---|---|
| Prevalence baseline | 0.274 | — |
| Random 5-fold | 0.407 | 0.678 |
| **Spatial block 5-fold** | **0.391 ± 0.034** | **0.666** |

**Lift over baseline: 1.43×.** Random CV overstates by only 4% here, which says
the 5.5 km blocks were already coarse enough that leakage was limited — worth
reporting either way.

This is a modest but real signal, and we state it as such. It is not the 0.9x
some papers report; those generally use 1 m LiDAR terrain, include the drainage
network, or validate without spatial blocking.

### Feature importance (gain)

```
road_density    24.5%
major_frac      12.6%
sink             9.6%
load_per_road    9.6%
relelev          9.3%
logacc           9.3%
hand             8.7%
slope            8.6%
twi              7.8%
```

Urban form (road density + arterial share) carries **37%** — more than any
terrain variable. That is a substantive finding for the Madinah design: we had
weighted terrain most heavily.

### On the road-density question

The hypothesis was that *low* road density means more water collects. The data
says the opposite, monotonically:

| Quintile | road density (km/km²) | flood rate |
|---|---|---|
| Q1 | ≤ 6.7 | **9.6%** |
| Q2 | ≤ 9.5 | 22.6% |
| Q3 | ≤ 11.6 | 30.5% |
| Q4 | ≤ 14.0 | 36.2% |
| Q5 | > 14.0 | **38.2%** |

**Dense street networks flood ~4× more often than sparse ones.** The mechanism is
imperviousness: road density is a proxy for paved area, and paved area produces
runoff instead of absorbing it. This matches the literature, which finds
impervious surface density to be the single most critical factor.

The intuition is not worthless though — it points at a real quantity, just not
density alone. What actually matters is **load per unit of drainage**: a segment
receiving a large upslope area with little street (and therefore few inlets) to
carry it away. That is the `load_per_road` feature, and it earns 9.6% of gain on
its own.

## Known gaps

- **`dist_to_drain` is missing**, and it is one of the strongest features in
  theory. NYC publishes catch-basin locations; adding them is the highest-value
  next step and would also validate that part of the Madinah design.
- **30 m DEM in a city.** NYC has 1 ft LiDAR. Re-running on it would separate
  "our features are weak" from "our terrain is too coarse".
- **No imperviousness layer yet** — road density is standing in for it.
- **No rainfall exposure term**: every cell is treated as equally rained-on.

## Transfer to Madinah

What carries: the terrain-hydrology relationships are physical. The feature
definitions, the negative-sampling rule and the spatial-CV protocol carry
unchanged.

What does not: NYC is humid-temperate with combined sewers; Madinah is arid with
~30 rain events in eleven years. **Weights do not transfer — the model form
does.** Madinah's own weights need Madinah labels, which is what the radar
self-labelling and a field campaign are for.

## Reproduce

```bash
docker run --rm -v "$PWD:/app" -w /app python:3.11 \
  sh -c "pip install -q rasterio numpy scipy scikit-learn xgboost && \
         python research/nyc_model.py && python research/nyc_train.py"
```

`nyc_model.py` builds the terrain stack and caches labels and roads;
`nyc_train.py` grids, samples, trains and writes `results.json`.
