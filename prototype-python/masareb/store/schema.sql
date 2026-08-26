-- مَسارب / Masareb — analytical schema
--
-- Design rule that governs this file: the columns marked "honesty" below exist so
-- that reporting a silent zero is structurally impossible. The system is required
-- to distinguish "we observed nothing" from "we could not observe".
--
-- CRS: geom is EPSG:4326. Every metric operation goes through
-- masareb.store.db.to_metric(), which passes always_xy:=true — DuckDB's
-- ST_Transform otherwise honours EPSG:4326 authority axis order (lat,lon) and
-- silently swaps coordinates.

INSTALL spatial; LOAD spatial;
INSTALL json;    LOAD json;

-- ─────────────────────────────── UNITS ───────────────────────────────
-- One polymorphic table for every unit of analysis: green assets, their spill
-- rings, street segments, micro-catchments. One map endpoint, one join key.
CREATE TABLE IF NOT EXISTS units (
  unit_id              VARCHAR PRIMARY KEY,
  unit_type            VARCHAR NOT NULL
      CHECK (unit_type IN ('green','ring','segment','catchment')),
  parent_unit_id       VARCHAR,          -- ring -> its green; segment -> its catchment
  name_ar              VARCHAR,
  name_en              VARCHAR,
  district_ar          VARCHAR,
  source               VARCHAR NOT NULL, -- osm | s2_ndvi_vector | derived_buffer | d8_catchment
  source_ref           VARCHAR,          -- OSM way id, etc.
  geom                 GEOMETRY NOT NULL,
  bbox_minx DOUBLE, bbox_miny DOUBLE, bbox_maxx DOUBLE, bbox_maxy DOUBLE,
  centroid_lon DOUBLE, centroid_lat DOUBLE,
  area_m2              DOUBLE,           -- polygons
  length_m             DOUBLE,           -- segments

  -- Module A (green / ring)
  ring_impervious_frac DOUBLE,
  ring_pixel_count     INTEGER,

  -- Module B (segment / catchment)
  highway_class        VARCHAR,
  slope_pct            DOUBLE,
  twi                  DOUBLE,
  hand_m               DOUBLE,           -- height above Aqiq / Buthan / Qanat network
  sink_depth_m         DOUBLE,
  upstream_area_km2    DOUBLE,
  impervious_frac      DOUBLE,
  built_frac           DOUBLE,           -- decides the SAR sign (see config)
  dist_to_wadi_m       DOUBLE,
  dist_to_culvert_m    DOUBLE,           -- NULL when the drainage layer is unavailable

  -- honesty
  dtm_confidence       VARCHAR DEFAULT 'unknown'
      CHECK (dtm_confidence IN ('high','medium','low','unknown')),
  geometry_confidence  VARCHAR DEFAULT 'medium'
      CHECK (geometry_confidence IN ('high','medium','low')),
  sar_visibility       VARCHAR DEFAULT 'unknown'
      CHECK (sar_visibility IN ('good','partial','blind','unknown')),
  validation_level     VARCHAR DEFAULT 'unvalidated'
      CHECK (validation_level IN ('unvalidated','satellite_only','cross_sensor','field_verified')),
  qa_flags             JSON,
  active               BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_units_type   ON units(unit_type, active);
CREATE INDEX IF NOT EXISTS ix_units_parent ON units(parent_unit_id);
CREATE INDEX IF NOT EXISTS ix_units_bbox   ON units(bbox_minx, bbox_miny, bbox_maxx, bbox_maxy);

-- ──────────────────────────── OBSERVATIONS ────────────────────────────
-- The ONE shared time series. Module A reads it filtered to green/ring,
-- Module B to segment/catchment. Same ingest, same incremental logic.
CREATE TABLE IF NOT EXISTS observations (
  unit_id          VARCHAR NOT NULL,
  obs_ts           TIMESTAMP NOT NULL,
  obs_date         DATE NOT NULL,
  sensor           VARCHAR NOT NULL CHECK (sensor IN ('S2','S1','L8','L9')),
  scene_id         VARCHAR,

  -- optical
  ndvi DOUBLE, ndwi DOUBLE, savi DOUBLE,
  mndwi DOUBLE, ndmi DOUBLE, ndbi DOUBLE,
  -- honesty: MNDWI/NDMI/NDBI derive from B11/B8A, which are 20 m native, not 10 m.
  optical_native_scale_m DOUBLE DEFAULT 10,
  wet_pixel_frac   DOUBLE,
  wet_area_m2      DOUBLE,

  -- SAR
  vv_db DOUBLE, vh_db DOUBLE,
  rel_orbit        INTEGER,   -- comparisons are only ever valid WITHIN one track
  orbit_pass       VARCHAR CHECK (orbit_pass IN ('ASCENDING','DESCENDING')),
  incidence_deg    DOUBLE,

  -- thermal
  lst_c DOUBLE,

  -- quality
  valid_pixel_frac DOUBLE,
  cloud_percent    DOUBLE,
  quality_flag     VARCHAR NOT NULL DEFAULT 'ok'
      CHECK (quality_flag IN ('ok','partial','cloud_blocked','sar_blind',
                              'shadow_layover','too_few_pixels','interpolated')),

  -- weather denormalised on purpose: it is the discriminator every detector needs
  rain_24h_mm DOUBLE, rain_72h_mm DOUBLE, days_since_rain INTEGER,

  ingested_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (unit_id, sensor, obs_ts)
);
CREATE INDEX IF NOT EXISTS ix_obs_unit_date ON observations(unit_id, obs_date DESC);
CREATE INDEX IF NOT EXISTS ix_obs_date      ON observations(obs_date DESC);

-- ───────────────────────── WASTE EVENTS (Module A) ─────────────────────────
CREATE TABLE IF NOT EXISTS waste_events (
  event_id             VARCHAR PRIMARY KEY,
  green_unit_id        VARCHAR NOT NULL,
  ring_unit_id         VARCHAR,
  detected_on          DATE NOT NULL,
  obs_ts               TIMESTAMP NOT NULL,
  n_consecutive_passes INTEGER DEFAULT 1,
  status               VARCHAR NOT NULL DEFAULT 'suspected'
      CHECK (status IN ('suspected','confirmed','resolved','dismissed','unverifiable')),
  severity             VARCHAR CHECK (severity IN ('low','medium','high')),
  severity_score       DOUBLE,

  -- evidence
  mndwi_ring           DOUBLE,
  mndwi_ring_baseline  DOUBLE,
  mndwi_ring_sigma     DOUBLE,
  z_ring               DOUBLE,
  ndmi_green           DOUBLE,
  z_ndmi_green         DOUBLE,
  lst_anomaly_c        DOUBLE,
  wet_area_m2          DOUBLE,

  -- the rainless gate, stored per event so the judgement is reproducible
  rain_72h_mm          DOUBLE NOT NULL,
  days_since_rain      INTEGER NOT NULL,

  -- estimate, never a bare number
  est_excess_m3        DOUBLE,
  est_excess_m3_low    DOUBLE,
  est_excess_m3_high   DOUBLE,
  estimate_method      VARCHAR DEFAULT 'film_depth_proxy_v1',
  estimate_confidence  VARCHAR DEFAULT 'low'
      CHECK (estimate_confidence IN ('low','medium','high')),

  signature            VARCHAR   -- periodic (schedule) | persistent (leak) | sporadic
      CHECK (signature IN ('periodic','persistent','sporadic','unknown')),
  detection_status     VARCHAR NOT NULL DEFAULT 'detected'
      CHECK (detection_status IN ('detected','cloud_blocked','missed_revisit',
                                  'ring_too_small','mixed_pixel_risk','ambiguous')),
  validation_level     VARCHAR DEFAULT 'satellite_only',
  explanation_ar       VARCHAR,
  recommendation_ar    VARCHAR,
  evidence             JSON,
  created_at           TIMESTAMP DEFAULT now(),
  UNIQUE (green_unit_id, detected_on)
);
CREATE INDEX IF NOT EXISTS ix_waste_date   ON waste_events(detected_on DESC);
CREATE INDEX IF NOT EXISTS ix_waste_status ON waste_events(status, severity_score DESC);

-- ─────────────────────────────── RAIN ───────────────────────────────
CREATE TABLE IF NOT EXISTS weather_daily (
  date DATE PRIMARY KEY,
  precipitation_sum_mm DOUBLE,
  precipitation_hours DOUBLE,
  temperature_2m_max DOUBLE,
  temperature_2m_min DOUBLE,
  shortwave_radiation_sum DOUBLE,
  et0_fao_evapotranspiration DOUBLE,
  rain_72h_mm DOUBLE,
  days_since_rain INTEGER,
  source VARCHAR DEFAULT 'open_meteo_archive'
);

CREATE TABLE IF NOT EXISTS rain_events (
  rain_event_id VARCHAR PRIMARY KEY,
  start_date DATE, end_date DATE, peak_date DATE,
  total_mm DOUBLE, max_daily_mm DOUBLE,
  n_s1_scenes_post INTEGER,
  n_segments_observable INTEGER,   -- the honest denominator for "6 of 19"
  created_at TIMESTAMP DEFAULT now()
);

-- ──────────────────── PONDING OBSERVATIONS (Module B) ────────────────────
CREATE TABLE IF NOT EXISTS ponding_observations (
  ponding_id       VARCHAR PRIMARY KEY,
  segment_unit_id  VARCHAR NOT NULL,
  rain_event_id    VARCHAR,
  obs_ts           TIMESTAMP NOT NULL,
  hours_after_rain DOUBLE,
  sensor           VARCHAR NOT NULL CHECK (sensor IN ('S1','S2')),

  vv_event_db DOUBLE, vv_dryref_db DOUBLE, delta_vv_db DOUBLE,
  rel_orbit INTEGER, orbit_pass VARCHAR, n_dryref_scenes INTEGER,

  built_frac DOUBLE,
  interpretation VARCHAR
      CHECK (interpretation IN ('open_dark','urban_bright','ambiguous')),
  threshold_used_db DOUBLE,

  mndwi DOUBLE,
  ponded BOOLEAN,
  ponded_confidence DOUBLE,
  ponded_area_m2 DOUBLE,
  recession_hours DOUBLE,

  -- 'not_detected' and 'sar_blind' are DIFFERENT values and are never collapsed.
  detection_status VARCHAR NOT NULL DEFAULT 'detected'
      CHECK (detection_status IN ('detected','not_detected','sar_blind','shadow_layover',
                                  'cloud_blocked','missed_revisit','no_dry_reference',
                                  'orbit_mismatch','ambiguous')),
  label_source     VARCHAR DEFAULT 's1_self_label',
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (segment_unit_id, obs_ts, sensor)
);
CREATE INDEX IF NOT EXISTS ix_pond_seg   ON ponding_observations(segment_unit_id, obs_ts DESC);
CREATE INDEX IF NOT EXISTS ix_pond_event ON ponding_observations(rain_event_id, ponded);

-- ─────────────────────────── SEGMENT RISK ───────────────────────────
CREATE TABLE IF NOT EXISTS segment_risk (
  segment_unit_id VARCHAR NOT NULL,
  scored_at       TIMESTAMP NOT NULL,
  model_version   VARCHAR NOT NULL,        -- wi_v1 (weighted index) | xgb_v1
  risk_score      DOUBLE NOT NULL,
  risk_rank       INTEGER,
  risk_band       VARCHAR
      CHECK (risk_band IN ('critical','high','moderate','stable','insufficient_data')),

  -- features stored so the explanation is reproducible offline
  f_twi DOUBLE, f_hand_m DOUBLE, f_sink_depth_m DOUBLE, f_slope_pct DOUBLE,
  f_upstream_area_km2 DOUBLE, f_impervious_frac DOUBLE, f_built_frac DOUBLE,
  f_dist_to_wadi_m DOUBLE, f_dist_to_culvert_m DOUBLE,
  f_pond_events INTEGER, f_rain_events_observed INTEGER, f_pond_frequency DOUBLE,

  contributions JSON,   -- per-feature contribution to the score
  top_drivers   JSON,   -- [{feature, label_ar, contrib, value}]

  recommended_action    VARCHAR,
  recommended_action_ar VARCHAR,
  action_rationale_ar   VARCHAR,
  est_cost_sar DOUBLE,
  requires_hydraulic_engineer BOOLEAN DEFAULT FALSE,

  -- honesty: a street we could not see is never reported as safe
  observation_coverage DOUBLE,
  dtm_confidence   VARCHAR,
  validation_level VARCHAR DEFAULT 'satellite_only',
  PRIMARY KEY (segment_unit_id, scored_at, model_version)
);
CREATE INDEX IF NOT EXISTS ix_risk_latest ON segment_risk(scored_at DESC, risk_score DESC);

-- ─────────────────────────────── ALERTS ───────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  alert_id   VARCHAR PRIMARY KEY,
  alert_type VARCHAR NOT NULL
      CHECK (alert_type IN ('pre_rain','rain_active','post_rain_verification',
                            'waste_confirmed','waste_persistent',
                            'project_underperforming','pipeline_degraded')),
  module   VARCHAR NOT NULL CHECK (module IN ('waste','flood','system')),
  severity VARCHAR NOT NULL CHECK (severity IN ('info','watch','warning','critical')),
  status   VARCHAR NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','acknowledged','resolved','expired','suppressed')),
  suppression_reason VARCHAR,

  scope VARCHAR NOT NULL CHECK (scope IN ('city','district','unit')),
  district_ar VARCHAR,
  unit_ids JSON,
  n_units INTEGER,

  issued_at TIMESTAMP NOT NULL,
  valid_until TIMESTAMP,
  lead_time_h DOUBLE,

  rule_id VARCHAR NOT NULL,
  trigger JSON,

  dedupe_key VARCHAR NOT NULL UNIQUE,
  cooldown_until TIMESTAMP,
  n_consecutive_triggers INTEGER DEFAULT 1,
  min_persistence_required INTEGER DEFAULT 1,

  channels JSON,
  delivery_status VARCHAR DEFAULT 'pending'
      CHECK (delivery_status IN ('pending','sent','partial','failed',
                                 'dry_run','held_for_persistence')),
  delivered_at TIMESTAMP,
  delivery_error VARCHAR,

  title_ar VARCHAR, body_ar VARCHAR, action_ar VARCHAR, deeplink VARCHAR,

  -- closing the loop: the system grades its own forecast
  outcome VARCHAR CHECK (outcome IN ('confirmed','not_observed','unverifiable','pending')),
  outcome_note_ar VARCHAR,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_alerts_active ON alerts(status, issued_at DESC);

-- ──────────────────── PROJECTS / BEFORE-AFTER VERIFICATION ────────────────────
CREATE TABLE IF NOT EXISTS projects (
  project_id VARCHAR PRIMARY KEY,
  name_ar VARCHAR,
  project_type VARCHAR,   -- box_culvert | lateral_network | horizontal_drilling | ...
  district_ar VARCHAR,
  geom GEOMETRY,
  affected_segment_ids JSON,
  commissioned_on DATE NOT NULL,
  length_m DOUBLE, diameter_mm DOUBLE,
  source VARCHAR DEFAULT 'amanah_public',
  source_confidence VARCHAR DEFAULT 'low'
      CHECK (source_confidence IN ('low','medium','high')),
  geometry_note VARCHAR DEFAULT 'exact alignment not published; approximated from public description',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_verifications (
  verification_id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  computed_at TIMESTAMP DEFAULT now(),
  n_rain_events_before INTEGER, n_rain_events_after INTEGER,
  n_observable_before INTEGER,  n_observable_after INTEGER,   -- honest denominators
  n_ponding_before INTEGER,     n_ponding_after INTEGER,
  pond_freq_before DOUBLE,      pond_freq_after DOUBLE,
  mean_area_before_m2 DOUBLE,   mean_area_after_m2 DOUBLE,
  delta_pond_freq DOUBLE,
  effect_direction  VARCHAR
      CHECK (effect_direction IN ('improved','no_change','worsened','inconclusive')),
  effect_confidence VARCHAR CHECK (effect_confidence IN ('low','medium','high')),
  rain_comparability VARCHAR
      CHECK (rain_comparability IN ('matched','partially_matched','unmatched')),
  matched_on JSON,
  narrative_ar VARCHAR,
  UNIQUE (project_id)
);

-- ──────────────────────── PIPELINE AUDIT (append-only) ────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id VARCHAR PRIMARY KEY,
  job_name VARCHAR NOT NULL,
  started_at TIMESTAMP, finished_at TIMESTAMP, duration_s DOUBLE,
  status VARCHAR CHECK (status IN ('running','ok','partial','failed','skipped')),
  n_units_in INTEGER, n_rows_written INTEGER, n_events INTEGER,
  n_cloud_blocked INTEGER, n_missed_revisit INTEGER, n_sar_blind INTEGER,
  coverage_pct DOUBLE,
  gee_calls INTEGER,
  params JSON, error VARCHAR, notes VARCHAR
);
CREATE INDEX IF NOT EXISTS ix_runs_job ON pipeline_runs(job_name, started_at DESC);
