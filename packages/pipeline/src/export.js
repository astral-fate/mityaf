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
      s: r.risk_score === null ? null : Math.round(r.risk_score * 100),
      b: r.risk_band ?? 'insufficient_data',
    })),
  );
}

async function exportGreen() {
  const { rows } = await query(
    `SELECT unit_id, unit_type, parent_unit_id, name_ar, area_m2, qa_flags,
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
    `SELECT w.*, u.name_ar AS unit_name_ar
       FROM waste_events w
       LEFT JOIN units u ON u.unit_id = w.green_unit_id
      ORDER BY w.severity_score DESC NULLS LAST
      LIMIT 500`,
  );
  return writeJson('waste-events.json', { items: rows, count: rows.length });
}

async function exportSegmentDetails() {
  const { rows } = await query(
    `SELECT r.*,
            u.name_ar, u.highway_class, u.length_m,
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
      highwayClass: r.highway_class,
      lengthM: r.length_m,
      dtmConfidence: r.dtm_confidence,
      sarVisibility: r.sar_visibility,
      centroid: [r.lon, r.lat],
    },
  }));
  return writeJson('segments-top.json', { items, count: items.length });
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
  console.log(`\n  total payload: ${(total / 1024).toFixed(1)} MB uncompressed ` +
              `(gzip on the wire is roughly a quarter of that)`);
  return total;
}
