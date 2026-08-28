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
import { kindMeta } from './asset-kind.js';

/**
 * node-postgres hands back a DATE column as a JS Date, and String(date) on one
 * of those is "Tue Sep 02 2025 00:00:00 GMT+0000" — so slicing ten characters
 * off it yields "Tue Sep 02": no year, unsortable, and silently wrong in every
 * consumer that compares or filters on it. Format explicitly instead.
 *
 * Built from the UTC parts rather than toISOString() so a date that arrives at
 * local midnight cannot roll back a day on a machine west of UTC.
 */
function isoDate(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

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
            r.risk_band,
            r.risk_rank,
            r.f_twi, r.f_hand_m, r.f_sink_depth_m, r.f_slope_pct
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
      rk: r.risk_rank,
      twi: r.f_twi === null ? null : Math.round(r.f_twi * 100) / 100,
      hand: r.f_hand_m === null ? null : Math.round(r.f_hand_m * 10) / 10,
      sink: r.f_sink_depth_m === null ? null : Math.round(r.f_sink_depth_m * 100) / 100,
      slope: r.f_slope_pct === null ? null : Math.round(r.f_slope_pct * 100) / 100,
    })),
  );
}

async function exportGreen() {
  const { rows } = await query(
    `SELECT unit_id, unit_type, parent_unit_id, name_ar, display_name_ar,
            asset_kind, asset_kind_ar, district_ar, area_m2, qa_flags,
            effective_width_m, nearest_street_ar, nearest_street_m,
            ST_X(centroid) AS lon, ST_Y(centroid) AS lat,
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
      kind: r.asset_kind,
      kindAr: r.asset_kind_ar,
      // a sand pitch reading NDVI 0.09 is working as designed, and must
      // not be counted beside a park that lost its planting. The rule lives in
      // asset-kind.js so courts and verges cannot disagree with it here.
      expectsVeg: kindMeta(r.asset_kind).expectsVegetation,
      widthM: r.effective_width_m === null ? null : Math.round(r.effective_width_m * 10) / 10,
      // Six decimals is ~0.1 m — past the point where more digits would be
      // claiming precision the geometry does not have.
      lon: r.lon === null ? null : Number(r.lon.toFixed(6)),
      lat: r.lat === null ? null : Number(r.lat.toFixed(6)),
      street: r.nearest_street_ar,
      streetM: r.nearest_street_m === null ? null : Math.round(r.nearest_street_m),
      parent: r.parent_unit_id,
      name: r.display_name_ar ?? r.name_ar,
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
      LIMIT 2000`,
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
    rationaleAr: r.action_rationale_ar,
    twi: r.f_twi,
    handM: r.f_hand_m,
    sinkDepthM: r.f_sink_depth_m,
    slopePct: r.f_slope_pct,
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

/**
 * The latest health verdict per green asset.
 *
 * DISTINCT ON keeps only the most recent assessment per asset — the table
 * stores every assessment date so the judgement has a history, but the
 * dashboard only ever wants the current call.
 */
async function exportGreenHealth() {
  const { rows } = await query(
    `SELECT DISTINCT ON (green_unit_id)
            green_unit_id, assessed_on, status, ndvi_median, ndvi_max, ndmi_median, ndvi_slope_yr,
            ndmi_slope_yr, ndmi_reliable, n_observations, reason_ar,
            actionable, priority, action_ar
       FROM green_health
      ORDER BY green_unit_id, assessed_on DESC`,
  );
  return writeJson('green-health.json', {
    items: rows.map((r) => ({
      greenUnitId: r.green_unit_id,
      assessedOn: isoDate(r.assessed_on),
      status: r.status,
      ndviMedian: r.ndvi_median,
      ndviMax: r.ndvi_max,
      ndmiMedian: r.ndmi_median,
      ndviSlopeYr: r.ndvi_slope_yr,
      ndmiSlopeYr: r.ndmi_slope_yr,
      ndmiReliable: r.ndmi_reliable,
      nObservations: r.n_observations,
      reasonAr: r.reason_ar,
      actionable: r.actionable,
      priority: r.priority,
      actionAr: r.action_ar,
    })),
    count: rows.length,
    actionable: rows.filter((r) => r.actionable).length,
  });
}

/**
 * One file per green asset: its full index history plus its verdict.
 *
 * Split per asset rather than shipped as one blob because the detail page
 * needs exactly one of them. A combined file would be roughly 324 x 140
 * readings that every visitor downloads to look at a single park.
 */
async function exportGreenSeries() {
  const { rows: units } = await query(
    `SELECT u.unit_id, u.name_ar, u.display_name_ar, u.district_ar, u.area_m2,
            u.asset_kind, u.asset_kind_ar, u.effective_width_m,
            u.nearest_street_ar, u.nearest_street_m, u.geometry_confidence,
            ST_AsGeoJSON(u.geom, 6) AS gj,
            ST_X(ST_PointOnSurface(u.geom)) AS lon,
            ST_Y(ST_PointOnSurface(u.geom)) AS lat,
            h.status, h.ndvi_median, h.ndvi_max, h.ndmi_median,
            h.ndvi_slope_yr, h.ndmi_slope_yr, h.ndmi_reliable,
            h.n_observations, h.reason_ar, h.assessed_on,
            h.actionable, h.priority, h.action_ar
       FROM units u
       LEFT JOIN LATERAL (
         SELECT * FROM green_health g
          WHERE g.green_unit_id = u.unit_id
          ORDER BY g.assessed_on DESC LIMIT 1
       ) h ON TRUE
      WHERE u.unit_type = 'green' AND u.active`);

  const { rows: obs } = await query(
    `SELECT o.unit_id, o.obs_date, o.ndvi, o.ndmi, o.ndwi, o.mndwi,
            o.rain_72h_mm, o.days_since_rain
       FROM observations o
       JOIN units u ON u.unit_id = o.unit_id
      WHERE u.unit_type = 'green' AND o.sensor = 'S2' AND o.quality_flag = 'ok'
      ORDER BY o.unit_id, o.obs_date`);

  const series = new Map();
  for (const o of obs) {
    if (!series.has(o.unit_id)) series.set(o.unit_id, []);
    series.get(o.unit_id).push({
      d: isoDate(o.obs_date),
      ndvi: o.ndvi === null ? null : Number(o.ndvi.toFixed(4)),
      ndmi: o.ndmi === null ? null : Number(o.ndmi.toFixed(4)),
      mndwi: o.mndwi === null ? null : Number(o.mndwi.toFixed(4)),
      rain72: o.rain_72h_mm,
    });
  }

  const dir = path.join(OUT(), 'green');
  await fs.mkdir(dir, { recursive: true });
  let bytes = 0;
  for (const u of units) {
    const payload = {
      id: u.unit_id,
      name: u.display_name_ar ?? u.name_ar,
      district: u.district_ar,
      kind: u.asset_kind,
      kindAr: u.asset_kind_ar,
      street: u.nearest_street_ar,
      streetM: u.nearest_street_m === null ? null : Math.round(u.nearest_street_m),
      widthM: u.effective_width_m === null ? null : Math.round(u.effective_width_m * 10) / 10,
      geometryConfidence: u.geometry_confidence,
      areaM2: u.area_m2,
      centroid: [u.lon, u.lat],
      geometry: JSON.parse(u.gj),
      health: u.status ? {
        status: u.status,
        assessedOn: isoDate(u.assessed_on),
        ndviMedian: u.ndvi_median,
        ndviMax: u.ndvi_max,
        ndmiMedian: u.ndmi_median,
        ndviSlopeYr: u.ndvi_slope_yr,
        ndmiSlopeYr: u.ndmi_slope_yr,
        ndmiReliable: u.ndmi_reliable,
        actionable: u.actionable,
        priority: u.priority,
        actionAr: u.action_ar,
        nObservations: u.n_observations,
        reasonAr: u.reason_ar,
      } : null,
      series: series.get(u.unit_id) ?? [],
    };
    const file = path.join(dir, `${u.unit_id}.json`);
    const text = JSON.stringify(payload);
    await fs.writeFile(file, text, 'utf8');
    bytes += Buffer.byteLength(text);
  }
  console.log(`  green/*.json           ${Math.round(bytes / 1024)} KB across ${units.length} files`);
  return Math.round(bytes / 1024);
}

/** Classified citizen reports and the alerts they cluster into. */
async function exportSocial() {
  const { rows } = await query(
    `SELECT report_id, source, synthetic, author, text_raw, created_at,
            category, district_ar, urgency, level, matched_terms, explanation_ar
       FROM social_reports ORDER BY created_at DESC LIMIT 500`);

  const posts = rows.map((r) => ({
    id: r.report_id,
    source: r.source,
    synthetic: r.synthetic,
    author: r.author,
    text: r.text_raw,
    createdAt: r.created_at,
    category: r.category,
    district: r.district_ar,
    urgency: r.urgency,
    level: r.level,
    matched: r.matched_terms?.matched ?? [],
    intensifiers: r.matched_terms?.intensifiers ?? [],
    explanationAr: r.explanation_ar,
  }));

  return writeJson('social.json', {
    posts,
    count: posts.length,
    // Stated at the top level so the UI can label the whole feed without
    // inspecting every row.
    anySynthetic: posts.some((p) => p.synthetic),
    allSynthetic: posts.length > 0 && posts.every((p) => p.synthetic),
  });
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
  total += await exportGreenHealth();
  total += await exportGreenSeries();
  total += await exportSocial();
  console.log(`\n  total payload: ${(total / 1024).toFixed(1)} MB uncompressed ` +
              `(gzip on the wire is roughly a quarter of that)`);
  return total;
}
