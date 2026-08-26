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
 * All geometry is Turf on WGS84 with metre units — geodesic, no projection step,
 * so the CRS axis-order class of bug cannot occur here.
 */
import * as turf from '@turf/turf';
import { config } from './config.js';
import { collections, connect } from './db.js';
import { ROAD_HALF_WIDTH_M, fetchLayer, inAoi, waysToRecords } from './osm.js';

const U = config.units;

const centroidOf = (geometry) => turf.centroid({ type: 'Feature', geometry, properties: {} }).geometry;

async function bulkUpsert(name, docs) {
  if (!docs.length) return 0;
  const d = await connect();
  const ops = docs.map((doc) => ({
    updateOne: { filter: { unitId: doc.unitId }, update: { $set: doc }, upsert: true },
  }));
  // chunk so a single bulk op never gets unwieldy
  let n = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const res = await d.collection(name).bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    n += (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
  }
  return docs.length;
}

// ── green ──────────────────────────────────────────────────────────────────
export async function buildGreen() {
  const recs = waysToRecords(await fetchLayer('green'));
  const docs = [];

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
    if (!inAoi(centroidOf(poly.geometry).coordinates)) continue;

    docs.push({
      unitId: `grn_${r.osmId}`,
      unitType: 'green',
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      source: 'osm',
      sourceRef: String(r.osmId),
      geometry: poly.geometry,
      centroid: centroidOf(poly.geometry),
      areaM2: Math.round(areaM2),
      geometryConfidence: 'high',
      validationLevel: 'unvalidated',
      active: true,
    });
  }

  const n = await bulkUpsert(collections.units, docs);
  console.log(`  green   : ${recs.length} candidates -> ${n} kept ` +
              `(${U.greenMinAreaM2}-${U.greenMaxAreaM2} m2, inside AOI)`);
  return n;
}

// ── rings ──────────────────────────────────────────────────────────────────
export async function buildRings() {
  const d = await connect();
  const greens = await d
    .collection(collections.units)
    .find({ unitType: 'green' })
    .project({ unitId: 1, nameAr: 1, geometry: 1 })
    .toArray();

  const docs = [];
  let tooSmall = 0;

  for (const g of greens) {
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
    for (const other of greens) {
      if (other.unitId === g.unitId) continue;
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

    docs.push({
      unitId: `rng_${g.unitId.slice(4)}`,
      unitType: 'ring',
      parentUnitId: g.unitId,
      nameAr: g.nameAr,
      source: 'derived_buffer',
      geometry: ring.geometry,
      centroid: centroidOf(ring.geometry),
      areaM2: Math.round(areaM2),
      geometryConfidence: 'high',
      // honesty: a ring under ~10 Sentinel-2 pixels cannot support a claim
      qaFlags: small ? { ringTooSmall: true } : {},
      validationLevel: 'unvalidated',
      active: true,
    });
  }

  const n = await bulkUpsert(collections.units, docs);
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
  const docs = [];
  let split = 0;

  for (const r of recs) {
    if (r.closed) continue; // roundabouts / service loops are not useful units
    const hw = r.highway ?? 'unclassified';
    const halfWidthM = ROAD_HALF_WIDTH_M[hw] ?? 6;

    for (const { index, feature, lengthM } of splitWay(r.coords)) {
      split++;
      const centroid = centroidOf(feature.geometry);
      // clip to AOI — Overpass returned whole ways, including highways that run
      // far outside the city
      if (!inAoi(centroid.coordinates)) continue;

      docs.push({
        unitId: `seg_${r.osmId}_${String(index).padStart(2, '0')}`,
        unitType: 'segment',
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        source: 'osm',
        sourceRef: String(r.osmId),
        geometry: feature.geometry,
        centroid,
        lengthM: Math.round(lengthM * 10) / 10,
        highwayClass: hw,
        halfWidthM,
        geometryConfidence: 'high',
        // honesty defaults until terrain and SAR visibility are computed
        dtmConfidence: 'unknown',
        sarVisibility: 'unknown',
        validationLevel: 'unvalidated',
        active: true,
      });
    }
  }

  const n = await bulkUpsert(collections.units, docs);
  console.log(`  segments: ${recs.length} ways -> ${split} split -> ${n} inside AOI`);
  return n;
}

export async function buildAll() {
  await buildGreen();
  await buildRings();
  await buildSegments();

  const d = await connect();
  const summary = await d
    .collection(collections.units)
    .aggregate([
      { $group: { _id: '$unitType', n: { $sum: 1 },
                  avg: { $avg: { $ifNull: ['$areaM2', '$lengthM'] } } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  console.log('\n  totals by unitType:');
  for (const s of summary) {
    console.log(`    ${String(s._id).padEnd(10)} ${String(s.n).padStart(6)}   avg size ${Math.round(s.avg).toLocaleString()}`);
  }
  return summary;
}
