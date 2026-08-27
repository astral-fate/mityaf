/**
 * Static export — the bridge between the batch pipeline and Vercel.
 *
 * Vercel has no writable filesystem, function timeouts of 10-60 s, and no
 * background scheduler, so it cannot run this pipeline live. It does not need
 * to: satellite revisit is 5 days, which makes the whole thing inherently batch.
 * The pipeline precomputes here, writes JSON into the web app's public/, and
 * Vercel serves it from the edge — faster than a live API would be, and it keeps
 * database and satellite credentials entirely off the web host.
 *
 * Map payloads are kept deliberately thin. Geometry is simplified server-side by
 * PostGIS: at a 10 m pixel scale, vertices finer than ~3 m carry no information
 * and only cost wire bytes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { query } from './db.js';

const OUT = () => path.resolve(process.cwd(), 'apps/web/public/data');

// ~3 m in degrees at this latitude
const SIMPLIFY_DEG = 3 / 111_000;

async function writeJson(name, data) {
  const dir = OUT();
  await fs.mkdir(dir, { recursive: true });
  const body = JSON.stringify(data);
  await fs.writeFile(path.join(dir, name), body, 'utf8');
  const kb = Buffer.byteLength(body) / 1024;
  console.log(`  ${name.padEnd(24)} ${kb.toFixed(0).padStart(7)} KB`);
  return kb;
}

/** Build a FeatureCollection from rows that carry a `gj` GeoJSON string. */
const toFeatureCollection = (rows, propsOf) => ({
  type: 'FeatureCollection',
  features: rows.map((r) => ({
    type: 'Feature',
    geometry: JSON.parse(r.gj),
    properties: propsOf(r),
  })),
});

// ── layers ─────────────────────────────────────────────────────────────────
async function exportSegments() {
  const { rows } = await query(
    `SELECT u.unit_id,
            u.name_ar,
            u.district_ar,
            ST_AsGeoJSON(ST_Simplify(u.geom, $1), 5) AS gj,
            r.risk_score,
            r.risk_band
       FROM units u
       LEFT JOIN segment_risk r ON r.segment_unit_id = u.unit_id
      WHERE u.unit_type = 'segment' AND u.active`,
    [SIMPLIFY_DEG],
  );

  // id + score only; everything else comes from the detail payload
  return writeJson(
    'segments.geojson',
    toFeatureCollection(rows, (r) => ({
      id: r.unit_id,
      name: r.name_ar,
      d: r.district_ar,
      s: r.risk_score === null ? null : Math.round(r.risk_score * 100),
      b: r.risk_band ?? 'insufficient_data',
    })),
  );
}

async function exportGreen() {
  const { rows } = await query(
    `SELECT unit_id, unit_type, parent_unit_id, name_ar, district_ar, area_m2, qa_flags,
            ST_AsGeoJSON(ST_Simplify(geom, $1), 5) AS gj
       FROM units
      WHERE unit_type IN ('green','ring') AND active`,
    [SIMPLIFY_DEG],
  );

  return writeJson(
    'green.geojson',
    toFeatureCollection(rows, (r) => ({
      id: r.unit_id,
      t: r.unit_type,
      district: r.district_ar,
      parent: r.parent_unit_id,
      name: r.name_ar,
      area: r.area_m2 === null ? null : Math.round(r.area_m2),
      // honesty travels with the geometry: the UI greys these out
      small: Boolean(r.qa_flags?.ringTooSmall),
    })),
  );
}

async function exportWasteEvents() {
  const { rows } = await query(
    `SELECT w.*, u.name_ar AS unit_name_ar, u.district_ar
       FROM waste_events w
       LEFT JOIN units u ON u.unit_id = w.green_unit_id
      ORDER BY w.severity_score DESC NULLS LAST
      LIMIT 500`,
  );

  // Shaped to match the flood detections rather than passed through raw. The
  // dashboard reads x.unit?.nameAr and x.greenUnitId for both kinds; handing
  // it snake_case here meant every waste row rendered a blank title, which
  // nothing revealed because the table is still empty.
  const items = rows.map((r) => ({
    eventId: r.event_id,
    greenUnitId: r.green_unit_id,
    ringUnitId: r.ring_unit_id,
    detectedOn: r.detected_on,
    severity: r.severity,
    severityScore: r.severity_score,
    zRing: r.z_ring,
    wetAreaM2: r.wet_area_m2,
    rain72hMm: r.rain_72h_mm,
    daysSinceRain: r.days_since_rain,
    estExcessM3: r.est_excess_m3,
    estExcessM3Low: r.est_excess_m3_low,
    estExcessM3High: r.est_excess_m3_high,
    estimateConfidence: r.estimate_confidence,
    detectionStatus: r.detection_status,
    signature: r.signature,
    explanationAr: r.explanation_ar,
    recommendationAr: r.recommendation_ar,
    unit: { nameAr: r.unit_name_ar, districtAr: r.district_ar },
  }));
  return writeJson('waste-events.json', { items, count: items.length });
}

async function exportSegmentDetails() {
  const { rows } = await query(
    `SELECT r.*,
            u.name_ar, u.district_ar, u.highway_class, u.length_m,
            u.dtm_confidence, u.sar_visibility,
            ST_X(u.centroid) AS lon, ST_Y(u.centroid) AS lat
       FROM segment_risk r
       JOIN units u ON u.unit_id = r.segment_unit_id
      ORDER BY r.risk_score DESC
      LIMIT 300`,
  );
  const items = rows.map((r) => ({
    segmentUnitId: r.segment_unit_id,
    riskScore: r.risk_score,
    riskBand: r.risk_band,
    riskRank: r.risk_rank,
    observationCoverage: r.observation_coverage,
    recommendedActionAr: r.recommended_action_ar,
    estCostSar: r.est_cost_sar,
    requiresHydraulicEngineer: r.requires_hydraulic_engineer,
    topDrivers: r.top_drivers,
    unit: {
      nameAr: r.name_ar,
      districtAr: r.district_ar,
      highwayClass: r.highway_class,
      lengthM: r.length_m,
      dtmConfidence: r.dtm_confidence,
      sarVisibility: r.sar_visibility,
      centroid: [r.lon, r.lat],
    },
  }));
  return writeJson('segments-top.json', { items, count: items.length });
}

/**
 * District cells plus a per-district roll-up.
 *
 * The counts ride along with the geometry rather than being recomputed in the
 * browser: the filter list needs them before any segment has been fetched,
 * and 30k features is the wrong thing to load just to count them.
 */
async function exportDistricts() {
  const { rows } = await query(
    `SELECT d.unit_id,
            d.name_ar,
            d.qa_flags,
            ST_AsGeoJSON(ST_Simplify(d.geom, $1), 5) AS gj,
            (SELECT count(*)::int FROM units u
              WHERE u.unit_type = 'segment' AND u.district_ar = d.name_ar) AS n_segments,
            (SELECT count(*)::int FROM units u
              WHERE u.unit_type = 'green' AND u.district_ar = d.name_ar) AS n_green,
            round((d.area_m2 / 1e6)::numeric, 2) AS area_km2
       FROM units d
      WHERE d.unit_type = 'district' AND d.active
      ORDER BY d.name_ar`,
    [SIMPLIFY_DEG],
  );

  return writeJson(
    'districts.geojson',
    toFeatureCollection(rows, (r) => ({
      id: r.unit_id,
      name: r.name_ar,
      seg: r.n_segments,
      green: r.n_green,
      km2: Number(r.area_km2),
      // stated on every feature, so nothing downstream can present a derived
      // boundary as an official one by omission
      derived: r.qa_flags?.boundarySource === 'voronoi',
    })),
  );
}

async function exportRain() {
  const { rows: events } = await query(
    `SELECT rain_event_id AS "rainEventId", start_date AS "startDate",
            end_date AS "endDate", peak_date AS "peakDate",
            total_mm AS "totalMm", max_daily_mm AS "maxDailyMm"
       FROM rain_events ORDER BY peak_date DESC`,
  );
  const { rows: recent } = await query(
    `SELECT date, precipitation_sum_mm AS "precipitationSumMm",
            rain_72h_mm AS "rain72hMm", days_since_rain AS "daysSinceRain"
       FROM weather_daily ORDER BY date DESC LIMIT 120`,
  );
  return writeJson('rain.json', { events, recent: recent.reverse() });
}

async function exportMeta() {
  const { rows: counts } = await query(
    `SELECT unit_type, count(*)::int AS n FROM units WHERE active GROUP BY unit_type`,
  );
  const { rows: runs } = await query(
    `SELECT run_id, job_name, status, duration_s, counts, started_at
       FROM pipeline_runs ORDER BY started_at DESC LIMIT 10`,
  );
  const { rows: totals } = await query(
    `SELECT (SELECT count(*)::int FROM observations)          AS observations,
            (SELECT count(*)::int FROM waste_events)          AS waste_events,
            (SELECT count(*)::int FROM ponding_observations)  AS ponding,
            (SELECT max(obs_date) FROM observations)          AS latest_obs`,
  );
  const { rows: km } = await query(
    `SELECT round(sum(length_m)/1000)::int AS km FROM units WHERE unit_type='segment' AND active`,
  );

  return writeJson('meta.json', {
    generatedAt: new Date().toISOString(),
    aoi: config.aoi,
    units: Object.fromEntries(counts.map((c) => [c.unit_type, c.n])),
    networkKm: km[0]?.km ?? null,
    observations: totals[0].observations,
    wasteEvents: totals[0].waste_events,
    pondingObservations: totals[0].ponding,
    latestObservation: totals[0].latest_obs,
    pipelineRuns: runs,
    dataMode: 'precomputed',
  });
}

export async function exportStatic() {
  console.log(`  writing to ${OUT()}`);
  let total = 0;
  total += await exportMeta();
  total += await exportGreen();
  total += await exportSegments();
  total += await exportSegmentDetails();
  total += await exportWasteEvents();
  total += await exportRain();
  total += await exportDistricts();
  console.log(`\n  total payload: ${(total / 1024).toFixed(1)} MB uncompressed ` +
              `(gzip on the wire is roughly a quarter of that)`);
  return total;
}
