# مِطياف platform — surfacing the ponding evidence

**Status:** approved design, pending implementation
**Date:** 2026-08-29

---

## Context

The site currently ranks streets by `riskScore` from an XGBoost model trained on
New York and Chicago complaint data. Work over the last day established that
this ranking is the weakest of the available options for Al Madinah, and that
three things the site does not show are stronger than anything it does.

**A verified site.** A resident reported chronic ponding on
عبدالله ابن اسلم البلوي in حي الملك فهد and supplied three coordinates. All
three fall inside one closed depression of 57 street segments, up to 0.69 m
deep, sitting more than a metre below its local drainage line, on ground in the
flattest 1% of the city. The basin's deepest point was computed from the DEM
*before* the third pin arrived; the pin landed **38 m** from it.

**Three mechanisms, not one.** Reported flooding divides into closed
depressions where water stays for days (الملك فهد, قباء, قربان), runoff
convergence where water sheets through during the storm (شارع البخاري, السلام,
العزيزية), and underpasses that are the lowest point on their road by
construction (نفق الملك عبدالله, named in a 2015 SPA report). A filter built
for one finds none of the others.

**An incident register.** 45 dated reports from four independent
streams — resident recollection, X posts, and two research documents — of which
**19 are corroborated** against rainfall and 26 are not. Two of those would have been rejected using ERA5
alone, because ERA5 records 0.00 days above 5 mm in August across 11.7 years
while NASA POWER measured 27.5 mm on 30 August 2024, the day a wedding was
filmed being washed out.

The platform should show this evidence. It currently shows none of it.

---

## Decisions taken

| Question | Decision |
|---|---|
| Green-cover pages | **Keep as-is.** Out of scope for this work. |
| Delivery | **Phased**, each phase independently demo-able |
| Rainfall data | **Baked at build time**, not fetched in the browser |
| Primary audience | **Hackathon judges**, with operational detail beneath |
| Headline score | **Hydrology rank replaces `riskScore`** everywhere |
| Deck consistency | **Regenerate** the deck's band counts from the new ranking |

---

## Architecture

One export script in `research/` writes static JSON into
`apps/web/public/data/`. The site reads those files and holds no analysis logic.
This keeps the browser free of API keys, works offline in a demo, and means the
research pipeline stays the single source of truth for every number shown.

```
research/export_web.py
  ├── reads  out/madinah_native_risk.csv, out/madinah_segments_features.csv
  │          out/shortlist/{type1,type2,type3}*.csv
  │          out/incidents/incident_register.csv, predicted_ponding_days.csv
  │          out/incidents/king_fahd_basin.csv
  └── writes apps/web/public/data/ponding-*.json
```

---

## Phase 1 — data layer

No visual change. Six files.

**`ponding-segments.json`** — all 30,337. Read only by the segment detail
page, as the fallback for an id that is not on the shortlist; the map moved to
`ponding-shortlist.json` in Phase 3.
`unitId, lat, lon, district, mechanism, priority, ranks{hyd,model,road,consensus},
terrain{sink,slope,hand,twi,logacc}, pct{...}, oodFlag` — 13.26 MB as shipped
(the ≈5 MB below was the estimate, not the measurement).

**`ponding-shortlist.json`** — the 2,617 flagged, same schema, sorted by
priority within mechanism. ≈450 KB. Tables and filters read this, never the
5 MB file.

**`ponding-tunnels.json`** — 47 underpasses: `osmId, name, highway, lat, lon,
lengthM, district, logacc, priority`. ≈12 KB.

**`districts-scored.geojson`** — the existing 91 features plus
`shortlistCount, depressionCount, convergenceCount, tunnelCount, topPriority,
medianHydRank, incidentCount, verified`.

**`incidents.json`** — the 45-row register: `date, district, place, source,
stream, lat, lon, mechanism, era5Mm, powerMm, bestMm, corroborated,
whichSource`. Uncorroborated rows are kept and marked, not dropped: many are
summer dates where both reanalyses are known to be unreliable.

**`rain-daily.json`** — 2015–2026 daily ERA5 and NASA POWER, plus a
`predictions` array of the wet days with no matching report.

**`basin.json`** — the King Fahd case study: 57 segments, three pins, the
computed core, bbox, depth statistics, the six corroborated dates.

**Verification:** every file validates against a schema; segment count is
exactly 30,337; district count exactly 91; incident count matches the register
CSV; no `NaN` reaches JSON.

## Phase 2 — segment and district pages

**`/dashboard/segments/[id]`** gains a mechanism badge, a terrain profile
showing each feature's value beside its city percentile, a plain-Arabic
explanation of why it is flagged, and the four rankings side by side. Showing
that hydrology says 0.99 where the trained model says 0.63 is honest and it is
the most interesting thing on the page.

**`/dashboard/districts`** replaces `seg / green / km²` with a real ranking:
shortlist count, mechanism split, top priority, incident count, and a verified
badge. الملك فهد leads on 160 segments and carries the badge; قربان shows the
highest depression density in the city at 21.9%.

**`riskScore` retires.** `segments-top.json` stays on disk so nothing breaks
mid-build, but no component reads it after this phase.

## Phase 3 — the evidence view

New route `/dashboard/evidence`. This is the judge-facing centrepiece and it
tells one story in order:

1. **The basin** — map, three pins, 57 segments, 0.69 m deep
2. **The prediction** — computed core at 24.5034, 39.7021; the pin at
   24.5037, 39.7022; **38 m apart**
3. **The timeline** — rainfall 2015–2026, 19 corroborated reports marked,
   uncorroborated reports shown distinctly, and wet days with no report at all
   shown as ghosts
4. **The August gap** — ERA5 0.1 mm against NASA POWER 26.6 mm on 30 Aug 2024,
   with the report that day on video
5. **Three mechanisms** — with شارع البخاري as the counter-example that broke
   the depression rule, and نفق الملك عبدالله as the one the DEM cannot see

## Phase 4 — filters and map

`FilterBar` gains mechanism, district, priority band, and reported-vs-predicted.
`MapView` colours by mechanism rather than one risk ramp — depression, runoff,
tunnel — sized by priority, with the basin as an overlay and the 47 underpasses
as a togglable layer.

---

## Deck regeneration

Changing the headline ranking invalidates figures already published in the deck,
the Arabic documentation and the model card: **1,517 critical / 483 inspect /
327 km**, all derived from `riskScore`.

After Phase 1, recompute the bands from the hydrology ranking and update
`deck/build_deck.py`, `masareb/docs/mityaf-documentation-ar.html` and
`MODEL-CARD.md`. Rebuild both PPTX files and both PDFs, and republish the two
artifacts.

The disagreement is itself reportable: two rankings of equal measured skill
share only 8–16% of their top 5%, so **changing the method replaces roughly 88%
of the inspection list**. That belongs in the deck as a finding, not a footnote.

---

## Risks

1. **File size.** 30,337 segments at ~15 fields was estimated at ≈5 MB; the
   shipped file is **13.26 MB**, 2.6× that. Mitigated for the map by the
   separate shortlist file, which the map now loads instead; the segment
   detail page still falls back to the full file for the 27,720 ids that are
   not shortlisted. Splitting it per id (the pattern `loadGreenDetail`
   already uses) is the next step and is its own plan.
2. **Two scores during Phase 2.** Between the data landing and the components
   switching, both `riskScore` and the hydrology rank exist. Phase 2 must
   finish before any demo.
3. **`social.json` is synthetic** — 30 fabricated posts flagged
   `allSynthetic: true`. Any screen that surfaces it needs a visible label. It
   is not part of this work and should stay off the new screens.
4. **Twenty-three uncorroborated reports** stay in the register marked, not
   deleted. They cluster in summer and shoulder months where ERA5 records
   essentially no rain and NASA POWER's grid is also coarse, so a failed check
   is weak evidence of a false report. The UI must distinguish *corroborated*
   from *reported but unverified* rather than hiding the latter.
5. **Nothing is validated in Madinah.** Every ranking shown is a prediction. The
   evidence view must say so plainly rather than implying measured accuracy.

---

## Verification

- Phase 1 output validates against schema; counts match source CSVs exactly.
- Every number rendered traces to a file in `research/out/` — no figure is
  computed in the browser.
- The three verified pins land in the top 1% of the depression ranking.
- نفق الملك عبدالله appears in the top 5 tunnels.
- Site builds and every existing route still renders after each phase.
- Deck rebuild produces 21 slides with no overflow, PDFs regenerate cleanly.
