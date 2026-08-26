-- مطياف / Mityaf — Postgres + PostGIS schema (Neon)
--
-- Design rule that governs this file: the columns marked "honesty" exist so that
-- reporting a silent zero is structurally impossible. The system is required to
-- distinguish "we observed nothing" from "we could not observe" — enforced here
-- with CHECK constraints rather than left to application code.
--
-- Geometry is stored in EPSG:4326. Metric work uses geography casts, which are
-- geodesic and take metres directly — so the CRS axis-order class of bug that
-- silently swaps lat/lon simply cannot occur.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────── UNITS ───────────────────────────────
-- One polymorphic table for every unit of analysis: green assets, their spill
-- rings, street segments, micro-catchments. One map query, one join key.
CREATE TABLE IF NOT EXISTS units (
  unit_id              TEXT PRIMARY KEY,
  unit_type            TEXT NOT NULL
      CHECK (unit_type IN ('green','ring','segment','catchment')),
  parent_unit_id       TEXT,
  name_ar              TEXT,
  name_en              TEXT,
  district_ar          TEXT,
  source               TEXT NOT NULL,
  source_ref           TEXT,
  geom                 geometry(Geometry, 4326) NOT NULL,
  centroid             geometry(Point, 4326),
  area_m2              DOUBLE PRECISION,
  length_m             DOUBLE PRECISION,

  -- Module A (green / ring)
  ring_impervious_frac DOUBLE PRECISION,
  ring_pixel_count     INTEGER,

  -- Module B (segment / catchment)
  highway_class        TEXT,
  half_width_m         DOUBLE PRECISION,
  slope_pct            DOUBLE PRECISION,
  twi                  DOUBLE PRECISION,
  hand_m               DOUBLE PRECISION,
  sink_depth_m         DOUBLE PRECISION,
  upstream_area_km2    DOUBLE PRECISION,
  impervious_frac      DOUBLE PRECISION,
  built_frac           DOUBLE PRECISION,
  dist_to_wadi_m       DOUBLE PRECISION,
  dist_to_culvert_m    DOUBLE PRECISION,

  -- honesty
  dtm_confidence       TEXT DEFAULT 'unknown'
      CHECK (dtm_confidence IN ('high','medium','low','unknown')),
  geometry_confidence  TEXT DEFAULT 'medium'
      CHECK (geometry_confidence IN ('high','medium','low')),
  sar_visibility       TEXT DEFAULT 'unknown'
      CHECK (sar_visibility IN ('good','partial','blind','unknown')),
  validation_level     TEXT DEFAULT 'unvalidated'
      CHECK (validation_level IN ('unvalidated','satellite_only','cross_sensor','field_verified')),
  qa_flags             JSONB DEFAULT '{}'::jsonb,
  active               BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_units_geom     ON units USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_units_centroid ON units USING GIST (centroid);
CREATE INDEX IF NOT EXISTS ix_units_type     ON units (unit_type, active);
CREATE INDEX IF NOT EXISTS ix_units_parent   ON units (parent_unit_id);

-- ──────────────────────────── OBSERVATIONS ────────────────────────────
-- The ONE shared time series. Module A reads it filtered to green/ring,
-- Module B to segment/catchment. Same ingest, same incremental logic.
CREATE TABLE IF NOT EXISTS observations (
  unit_id          TEXT NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  obs_ts           TIMESTAMPTZ NOT NULL,
  obs_date         DATE NOT NULL,
  sensor           TEXT NOT NULL CHECK (sensor IN ('S2','S1','L8','L9')),
  scene_id         TEXT,

  ndvi DOUBLE PRECISION, ndwi DOUBLE PRECISION, savi DOUBLE PRECISION,
  mndwi DOUBLE PRECISION, ndmi DOUBLE PRECISION, ndbi DOUBLE PRECISION,
  -- honesty: MNDWI/NDMI/NDBI derive from B11/B8A, which are 20 m native, not 10 m
  optical_native_scale_m DOUBLE PRECISION DEFAULT 10,
  wet_pixel_frac   DOUBLE PRECISION,
  wet_area_m2      DOUBLE PRECISION,

  vv_db DOUBLE PRECISION, vh_db DOUBLE PRECISION,
  rel_orbit        INTEGER,   -- comparisons are only valid WITHIN one track
  orbit_pass       TEXT CHECK (orbit_pass IN ('ASCENDING','DESCENDING')),
  incidence_deg    DOUBLE PRECISION,

  lst_c            DOUBLE PRECISION,

  valid_pixel_frac DOUBLE PRECISION,
  cloud_percent    DOUBLE PRECISION,
  quality_flag     TEXT NOT NULL DEFAULT 'ok'
      CHECK (quality_flag IN ('ok','partial','cloud_blocked','sar_blind',
                              'shadow_layover','too_few_pixels','interpolated')),

  -- weather denormalised on purpose: it is the discriminator every detector reads
  rain_24h_mm DOUBLE PRECISION,
  rain_72h_mm DOUBLE PRECISION,
  days_since_rain INTEGER,

  ingested_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (unit_id, sensor, obs_ts)
);
CREATE INDEX IF NOT EXISTS ix_obs_unit_date ON observations (unit_id, obs_date DESC);
CREATE INDEX IF NOT EXISTS ix_obs_date      ON observations (obs_date DESC);

-- ───────────────────────── WASTE EVENTS (Module A) ─────────────────────────
CREATE TABLE IF NOT EXISTS waste_events (
  event_id             TEXT PRIMARY KEY,
  green_unit_id        TEXT NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  ring_unit_id         TEXT,
  detected_on          DATE NOT NULL,
  obs_ts               TIMESTAMPTZ NOT NULL,
  n_consecutive_passes INTEGER DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'suspected'
      CHECK (status IN ('suspected','confirmed','resolved','dismissed','unverifiable')),
  severity             TEXT CHECK (severity IN ('low','medium','high')),
  severity_score       DOUBLE PRECISION,

  mndwi_ring           DOUBLE PRECISION,
  mndwi_ring_baseline  DOUBLE PRECISION,
  mndwi_ring_sigma     DOUBLE PRECISION,
  z_ring               DOUBLE PRECISION,
  ndmi_green           DOUBLE PRECISION,
  lst_anomaly_c        DOUBLE PRECISION,
  wet_area_m2          DOUBLE PRECISION,

  -- the rainless gate, stored per event so the judgement stays reproducible
  rain_72h_mm          DOUBLE PRECISION NOT NULL,
  days_since_rain      INTEGER NOT NULL,

  -- estimates are never a bare number
  est_excess_m3        DOUBLE PRECISION,
  est_excess_m3_low    DOUBLE PRECISION,
  est_excess_m3_high   DOUBLE PRECISION,
  estimate_method      TEXT DEFAULT 'film_depth_proxy_v1',
  estimate_confidence  TEXT DEFAULT 'low'
      CHECK (estimate_confidence IN ('low','medium','high')),

  signature            TEXT
      CHECK (signature IN ('periodic','persistent','sporadic','unknown')),
  detection_status     TEXT NOT NULL DEFAULT 'detected'
      CHECK (detection_status IN ('detected','cloud_blocked','missed_revisit',
                                  'ring_too_small','mixed_pixel_risk','ambiguous')),
  validation_level     TEXT DEFAULT 'satellite_only',
  explanation_ar       TEXT,
  recommendation_ar    TEXT,
  evidence             JSONB DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (green_unit_id, detected_on)
);
CREATE INDEX IF NOT EXISTS ix_waste_date   ON waste_events (detected_on DESC);
CREATE INDEX IF NOT EXISTS ix_waste_status ON waste_events (status, severity_score DESC);

-- ─────────────────────────────── RAIN ───────────────────────────────
CREATE TABLE IF NOT EXISTS weather_daily (
  date DATE PRIMARY KEY,
  precipitation_sum_mm DOUBLE PRECISION,
  precipitation_hours DOUBLE PRECISION,
  temperature_2m_max DOUBLE PRECISION,
  temperature_2m_min DOUBLE PRECISION,
  shortwave_radiation_sum DOUBLE PRECISION,
  et0_fao DOUBLE PRECISION,
  rain_72h_mm DOUBLE PRECISION,
  days_since_rain INTEGER,
  source TEXT DEFAULT 'open_meteo_archive'
);

CREATE TABLE IF NOT EXISTS rain_events (
  rain_event_id TEXT PRIMARY KEY,
  start_date DATE, end_date DATE, peak_date DATE,
  total_mm DOUBLE PRECISION, max_daily_mm DOUBLE PRECISION,
  n_s1_scenes_post INTEGER,
  n_segments_observable INTEGER,   -- the honest denominator for "6 of 19"
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rain_peak ON rain_events (peak_date DESC);

-- ──────────────────── PONDING OBSERVATIONS (Module B) ────────────────────
CREATE TABLE IF NOT EXISTS ponding_observations (
  ponding_id       TEXT PRIMARY KEY,
  segment_unit_id  TEXT NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  rain_event_id    TEXT REFERENCES rain_events(rain_event_id) ON DELETE SET NULL,
  obs_ts           TIMESTAMPTZ NOT NULL,
  hours_after_rain DOUBLE PRECISION,
  sensor           TEXT NOT NULL CHECK (sensor IN ('S1','S2')),

  vv_event_db DOUBLE PRECISION, vv_dryref_db DOUBLE PRECISION,
  delta_vv_db DOUBLE PRECISION,
  rel_orbit INTEGER, orbit_pass TEXT, n_dryref_scenes INTEGER,

  built_frac DOUBLE PRECISION,
  -- water in the open goes dark; between buildings it goes BRIGHT (corner
  -- reflector). The sign is chosen by built fraction, never globally.
  interpretation TEXT CHECK (interpretation IN ('open_dark','urban_bright','ambiguous')),
  threshold_used_db DOUBLE PRECISION,

  mndwi DOUBLE PRECISION,
  ponded BOOLEAN,
  ponded_confidence DOUBLE PRECISION,
  ponded_area_m2 DOUBLE PRECISION,
  recession_hours DOUBLE PRECISION,

  -- 'not_detected' and 'sar_blind' are DIFFERENT values, never collapsed
  detection_status TEXT NOT NULL DEFAULT 'detected'
      CHECK (detection_status IN ('detected','not_detected','sar_blind','shadow_layover',
                                  'cloud_blocked','missed_revisit','no_dry_reference',
                                  'orbit_mismatch','ambiguous')),
  label_source     TEXT DEFAULT 's1_self_label',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (segment_unit_id, obs_ts, sensor)
);
CREATE INDEX IF NOT EXISTS ix_pond_seg   ON ponding_observations (segment_unit_id, obs_ts DESC);
CREATE INDEX IF NOT EXISTS ix_pond_event ON ponding_observations (rain_event_id, ponded);

-- ─────────────────────────── SEGMENT RISK ───────────────────────────
CREATE TABLE IF NOT EXISTS segment_risk (
  segment_unit_id TEXT NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  model_version   TEXT NOT NULL,
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  risk_score      DOUBLE PRECISION NOT NULL,
  risk_rank       INTEGER,
  risk_band       TEXT
      CHECK (risk_band IN ('critical','high','moderate','stable','insufficient_data')),

  f_twi DOUBLE PRECISION, f_hand_m DOUBLE PRECISION,
  f_sink_depth_m DOUBLE PRECISION, f_slope_pct DOUBLE PRECISION,
  f_upstream_area_km2 DOUBLE PRECISION, f_impervious_frac DOUBLE PRECISION,
  f_built_frac DOUBLE PRECISION, f_dist_to_wadi_m DOUBLE PRECISION,
  f_dist_to_culvert_m DOUBLE PRECISION,
  f_pond_events INTEGER, f_rain_events_observed INTEGER,
  f_pond_frequency DOUBLE PRECISION,

  contributions JSONB DEFAULT '{}'::jsonb,
  top_drivers   JSONB DEFAULT '[]'::jsonb,

  recommended_action    TEXT,
  recommended_action_ar TEXT,
  action_rationale_ar   TEXT,
  est_cost_sar DOUBLE PRECISION,
  requires_hydraulic_engineer BOOLEAN DEFAULT FALSE,

  -- honesty: a street we could not see is never reported as safe
  observation_coverage DOUBLE PRECISION,
  dtm_confidence   TEXT,
  validation_level TEXT DEFAULT 'satellite_only',
  PRIMARY KEY (segment_unit_id, model_version)
);
CREATE INDEX IF NOT EXISTS ix_risk_score ON segment_risk (risk_score DESC);
CREATE INDEX IF NOT EXISTS ix_risk_band  ON segment_risk (risk_band, risk_score DESC);

-- ─────────────────────────────── ALERTS ───────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  alert_id   TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL
      CHECK (alert_type IN ('pre_rain','rain_active','post_rain_verification',
                            'waste_confirmed','waste_persistent',
                            'project_underperforming','pipeline_degraded')),
  module   TEXT NOT NULL CHECK (module IN ('waste','flood','system')),
  severity TEXT NOT NULL CHECK (severity IN ('info','watch','warning','critical')),
  status   TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','acknowledged','resolved','expired','suppressed')),
  suppression_reason TEXT,

  scope TEXT NOT NULL CHECK (scope IN ('city','district','unit')),
  district_ar TEXT,
  unit_ids JSONB DEFAULT '[]'::jsonb,
  n_units INTEGER,

  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  lead_time_h DOUBLE PRECISION,

  rule_id TEXT NOT NULL,
  trigger JSONB DEFAULT '{}'::jsonb,

  dedupe_key TEXT NOT NULL UNIQUE,
  cooldown_until TIMESTAMPTZ,
  n_consecutive_triggers INTEGER DEFAULT 1,
  min_persistence_required INTEGER DEFAULT 1,

  channels JSONB DEFAULT '[]'::jsonb,
  delivery_status TEXT DEFAULT 'pending'
      CHECK (delivery_status IN ('pending','sent','partial','failed',
                                 'dry_run','held_for_persistence')),
  delivered_at TIMESTAMPTZ,
  delivery_error TEXT,

  title_ar TEXT, body_ar TEXT, action_ar TEXT, deeplink TEXT,

  -- closing the loop: the system grades its own forecast
  outcome TEXT CHECK (outcome IN ('confirmed','not_observed','unverifiable','pending')),
  outcome_note_ar TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_alerts_active ON alerts (status, issued_at DESC);

-- ──────────────────── PROJECTS / BEFORE-AFTER VERIFICATION ────────────────────
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name_ar TEXT,
  project_type TEXT,
  district_ar TEXT,
  geom geometry(Geometry, 4326),
  affected_segment_ids JSONB DEFAULT '[]'::jsonb,
  commissioned_on DATE NOT NULL,
  length_m DOUBLE PRECISION, diameter_mm DOUBLE PRECISION,
  source TEXT DEFAULT 'amanah_public',
  source_confidence TEXT DEFAULT 'low'
      CHECK (source_confidence IN ('low','medium','high')),
  geometry_note TEXT DEFAULT 'exact alignment not published; approximated from public description',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_projects_geom ON projects USING GIST (geom);

CREATE TABLE IF NOT EXISTS project_verifications (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ DEFAULT now(),
  n_rain_events_before INTEGER, n_rain_events_after INTEGER,
  n_observable_before INTEGER,  n_observable_after INTEGER,   -- honest denominators
  n_ponding_before INTEGER,     n_ponding_after INTEGER,
  pond_freq_before DOUBLE PRECISION, pond_freq_after DOUBLE PRECISION,
  mean_area_before_m2 DOUBLE PRECISION, mean_area_after_m2 DOUBLE PRECISION,
  delta_pond_freq DOUBLE PRECISION,
  effect_direction  TEXT
      CHECK (effect_direction IN ('improved','no_change','worsened','inconclusive')),
  effect_confidence TEXT CHECK (effect_confidence IN ('low','medium','high')),
  rain_comparability TEXT
      CHECK (rain_comparability IN ('matched','partially_matched','unmatched')),
  matched_on JSONB DEFAULT '{}'::jsonb,
  narrative_ar TEXT
);

-- ──────────────────────── PIPELINE AUDIT (append-only) ────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, duration_s DOUBLE PRECISION,
  status TEXT CHECK (status IN ('running','ok','partial','failed','skipped')),
  counts JSONB DEFAULT '{}'::jsonb,
  coverage_pct DOUBLE PRECISION,
  params JSONB DEFAULT '{}'::jsonb,
  error TEXT
);
CREATE INDEX IF NOT EXISTS ix_runs_job ON pipeline_runs (job_name, started_at DESC);
