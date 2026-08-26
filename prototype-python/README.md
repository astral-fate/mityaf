# Python prototype (reference only)

The platform ships as an all-Node stack (see the repository root). This folder
keeps the original Python prototype because it is where several behaviours were
first validated against real data, and the Node implementation ports them
deliberately rather than reinventing them:

- **CRS axis order.** DuckDB's `ST_Transform` honours EPSG:4326 authority axis
  order (lat, lon), which silently swapped coordinates — a 0.01° latitude step
  measured 875 m instead of the true 1109 m. The Node stack sidesteps this class
  of bug entirely by using Turf.js on WGS84 with metre units (geodesic, no
  projection step).
- **Overpass returns whole ways.** `way(bbox)` returns ways that merely *touch*
  the bbox, so highways heading to Makkah arrived in full and inflated the
  network from 5,272 km to 5,627 km. Both implementations clip by centroid.
- **Overpass User-Agent.** The default library UA is rejected with HTTP 406 by
  the Apache in front of Overpass; OSM policy asks for an identifying UA anyway.
- **Rain reality check.** The archive showed *no* measurable rain at the Madinah
  centroid in August 2024, contradicting a claim taken from news reports. Only
  30 rain events ≥ 5 mm exist since 2015, and 2.3% of days are wet.

`brd/build_brd.py` at the repository root is also Python: it renders the
Business Requirements Document to a branded PDF. That is a documentation tool,
not part of the application runtime.

Nothing here is required to run or deploy the platform.
