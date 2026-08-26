/**
 * Build every unit of analysis from OpenStreetMap.
 *
 *   green    parks / gardens / grass / pitches
 *   ring     the spill ring: 2-20 m of surface just outside each green polygon.
 *            This is where over-irrigation physically shows up, and it is the
 *            entire basis of Module A. A wet park is ambiguous; wet asphalt
 *            beside a park on a rainless day is not.
 *   segment  street centrelines split to ~200 m
 *
 * Geometry is built with Turf on WGS84 in metre units (geodesic, no projection
 * step) and measured in Postgres with ::geography casts. Neither path has a
 * projection to get backwards, so the CRS axis-order class of bug cannot occur.
 */
import * as turf from '@turf/turf';
import { config } from './config.js';
import { bulkUpsert, query } from './db.js';
import { ROAD_HALF_WIDTH_M, fetchLayer, inAoi, waysToRecords } from './osm.js';

const U = config.units;

const centroidOf = (geometry) =>
  turf.centroid({ type: 'Feature', geometry, properties: {} }).geometry;

/** Geometry columns are bound as GeoJSON text and parsed server-side. */
const geomCol = (geometry) => ({ sql: 'ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)', value: JSON.stringify(geometry) });

const UNIT_COLUMNS = [
  'unit_id', 'unit_type', 'parent_unit_id', 'name_ar', 'name_en',
  'source', 'source_ref', 'geom', 'centroid', 'area_m2', 'length_m',
  'highway_class', 'half_width_m', 'geometry_confidence', 'qa_flags', 'active',
];

async function insertUnits(rows) {
  return bulkUpsert({
    table: 'units',
    columns: UNIT_COLUMNS,
    rows,
    conflictTarget: ['unit_id'],
  });
}

// ── green ──────────────────────────────────────────────────────────────────
export async function buildGreen() {
  const recs = waysToRecords(await fetchLayer('green'));
  const rows = [];

  for (const r of recs) {
    if (!r.closed || r.coords.length < 4) continue;
    let poly;
    try {
      poly = turf.polygon([r.coords]);
    } catch {
      continue; // self-intersecting or degenerate ring
    }
    const areaM2 = turf.area(poly);
    // a 30 m2 "park" is a mapping artefact; over 20 ha is usually a land-use
    // blob rather than an irrigated asset
    if (areaM2 < U.greenMinAreaM2 || areaM2 > U.greenMaxAreaM2) continue;
    const centroid = centroidOf(poly.geometry);
    if (!inAoi(centroid.coordinates)) continue;

    rows.push({
      unit_id: `grn_${r.osmId}`,
      unit_type: 'green',
      parent_unit_id: null,
      name_ar: r.nameAr,
      name_en: r.nameEn,
      source: 'osm',
      source_ref: String(r.osmId),
      geom: geomCol(poly.geometry),
      centroid: geomCol(centroid),
      area_m2: Math.round(areaM2),
      length_m: null,
      highway_class: null,
      half_width_m: null,
      geometry_confidence: 'high',
      qa_flags: '{}',
      active: true,
    });
  }

  const n = await insertUnits(rows);
  console.log(`  green   : ${recs.length} candidates -> ${n} kept ` +
              `(${U.greenMinAreaM2}-${U.greenMaxAreaM2} m2, inside AOI)`);
  return n;
}

// ── rings ──────────────────────────────────────────────────────────────────
export async function buildRings() {
  const { rows: greens } = await query(
    `SELECT unit_id, name_ar, ST_AsGeoJSON(geom) AS gj FROM units WHERE unit_type='green'`,
  );

  const parsed = greens.map((g) => ({ ...g, geometry: JSON.parse(g.gj) }));
  const rows = [];
  let tooSmall = 0;

  for (const g of parsed) {
    const feat = { type: 'Feature', geometry: g.geometry, properties: {} };
    // inner edge 2 m out skips the mixed pixel straddling the grass edge;
    // outer edge at 20 m keeps us on the immediately adjacent surface
    const outer = turf.buffer(feat, U.ringOuterM, { units: 'meters' });
    const inner = turf.buffer(feat, U.ringInnerM, { units: 'meters' });
    if (!outer || !inner) continue;

    let ring;
    try {
      ring = turf.difference(turf.featureCollection([outer, inner]));
    } catch {
      continue;
    }
    if (!ring) continue;

    // subtract any neighbouring green, so a ring never reports another park's
    // irrigation as this park's spill
    for (const other of parsed) {
      if (other.unit_id === g.unit_id) continue;
      const of = { type: 'Feature', geometry: other.geometry, properties: {} };
      try {
        if (!turf.booleanIntersects(ring, of)) continue;
        const cut = turf.difference(turf.featureCollection([ring, of]));
        if (cut) ring = cut;
      } catch {
        /* keep the uncut ring rather than dropping the unit */
      }
    }

    const areaM2 = turf.area(ring);
    if (areaM2 <= 0) continue;
    const small = areaM2 < U.ringTooSmallM2;
    if (small) tooSmall++;

    rows.push({
      unit_id: `rng_${g.unit_id.slice(4)}`,
      unit_type: 'ring',
      parent_unit_id: g.unit_id,
      name_ar: g.name_ar,
      name_en: null,
      source: 'derived_buffer',
      source_ref: null,
      geom: geomCol(ring.geometry),
      centroid: geomCol(centroidOf(ring.geometry)),
      area_m2: Math.round(areaM2),
      length_m: null,
      highway_class: null,
      half_width_m: null,
      geometry_confidence: 'high',
      // honesty: a ring under ~10 Sentinel-2 pixels cannot support a claim
      qa_flags: JSON.stringify(small ? { ringTooSmall: true } : {}),
      active: true,
    });
  }

  const n = await insertUnits(rows);
  console.log(`  rings   : ${n} built (${tooSmall} flagged ringTooSmall, < ${U.ringTooSmallM2} m2)`);
  return n;
}

// ── segments ───────────────────────────────────────────────────────────────
/** Split one way into ~200 m pieces. */
export function splitWay(coords) {
  const line = turf.lineString(coords);
  const totalKm = turf.length(line, { units: 'kilometers' });
  const totalM = totalKm * 1000;
  if (totalM < U.segmentMinLengthM) return [];

  const n = Math.max(1, Math.round(totalM / U.segmentLengthM));
  const stepKm = totalKm / n;
  const pieces = [];

  for (let i = 0; i < n; i++) {
    let piece;
    try {
      piece = turf.lineSliceAlong(line, i * stepKm, (i + 1) * stepKm, { units: 'kilometers' });
    } catch {
      continue;
    }
    if (!piece?.geometry?.coordinates || piece.geometry.coordinates.length < 2) continue;
    const pieceM = turf.length(piece, { units: 'kilometers' }) * 1000;
    if (pieceM < U.segmentMinLengthM && n > 1) continue;
    pieces.push({ index: i, feature: piece, lengthM: pieceM });
  }
  return pieces;
}

export async function buildSegments() {
  const recs = waysToRecords(await fetchLayer('streets'));
  const rows = [];
  let split = 0;

  for (const r of recs) {
    if (r.closed) continue; // roundabouts / service loops are not useful units
    const hw = r.highway ?? 'unclassified';

    for (const { index, feature, lengthM } of splitWay(r.coords)) {
      split++;
      const centroid = centroidOf(feature.geometry);
      // Overpass returns WHOLE ways that touch the bbox, so a highway heading
      // for Makkah arrives in full. Clip by centroid or we rank other cities.
      if (!inAoi(centroid.coordinates)) continue;

      rows.push({
        unit_id: `seg_${r.osmId}_${String(index).padStart(2, '0')}`,
        unit_type: 'segment',
        parent_unit_id: null,
        name_ar: r.nameAr,
        name_en: r.nameEn,
        source: 'osm',
        source_ref: String(r.osmId),
        geom: geomCol(feature.geometry),
        centroid: geomCol(centroid),
        area_m2: null,
        length_m: Math.round(lengthM * 10) / 10,
        highway_class: hw,
        half_width_m: ROAD_HALF_WIDTH_M[hw] ?? 6,
        geometry_confidence: 'high',
        qa_flags: '{}',
        active: true,
      });
    }
  }

  const n = await insertUnits(rows);
  console.log(`  segments: ${recs.length} ways -> ${split} split -> ${n} inside AOI`);
  return n;
}

export async function buildAll() {
  await buildGreen();
  await buildRings();
  await buildSegments();

  const { rows } = await query(
    `SELECT unit_type,
            count(*)::int              AS n,
            round(avg(COALESCE(area_m2, length_m)))::int AS avg_size,
            round(sum(length_m)/1000)::int              AS km
       FROM units WHERE active GROUP BY unit_type ORDER BY n DESC`,
  );

  console.log('\n  totals by unit_type:');
  for (const r of rows) {
    const km = r.km ? `  ${r.km.toLocaleString()} km` : '';
    console.log(`    ${String(r.unit_type).padEnd(10)} ${String(r.n).padStart(6)}   ` +
                `avg size ${Number(r.avg_size).toLocaleString()}${km}`);
  }
  return rows;
}
