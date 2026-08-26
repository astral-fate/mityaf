/**
 * Static export — the bridge between the batch pipeline and Vercel.
 *
 * Vercel has no writable filesystem, function timeouts of 10-60 s, and no
 * background scheduler, so it cannot run this pipeline live. It does not need
 * to: satellite revisit is 5 days, which makes the whole thing inherently batch.
 * The pipeline precomputes here, writes JSON into the web app's public/, and
 * Vercel serves it from the edge. That is faster than a live API would be.
 *
 * Map payloads are kept deliberately thin: the segments layer carries only what
 * the paint expression reads, because 30k LineStrings with full properties is
 * megabytes of wire for nothing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { collections, connect } from './db.js';
import { config } from './config.js';

const OUT = () => path.resolve(process.cwd(), 'apps/web/public/data');

const round = (n, dp = 5) =>
  n === null || n === undefined ? n : Math.round(n * 10 ** dp) / 10 ** dp;

/** Drop coordinate precision — 5 dp is ~1 m, far finer than a 10 m pixel. */
function thinGeometry(geom, dp = 5) {
  const walk = (c) =>
    typeof c[0] === 'number' ? [round(c[0], dp), round(c[1], dp)] : c.map(walk);
  return { ...geom, coordinates: walk(geom.coordinates) };
}

async function writeJson(name, data) {
  const dir = OUT();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  const body = JSON.stringify(data);
  await fs.writeFile(file, body, 'utf8');
  const kb = (Buffer.byteLength(body) / 1024).toFixed(0);
  console.log(`  ${name.padEnd(26)} ${String(kb).padStart(6)} KB`);
  return Number(kb);
}

// ── layers ─────────────────────────────────────────────────────────────────
async function exportSegments(d) {
  const risk = await d
    .collection(collections.segmentRisk)
    .find({})
    .project({ segmentUnitId: 1, riskScore: 1, riskBand: 1, _id: 0 })
    .toArray();
  const byId = new Map(risk.map((r) => [r.segmentUnitId, r]));

  const units = await d
    .collection(collections.units)
    .find({ unitType: 'segment', active: true })
    .project({ unitId: 1, geometry: 1, nameAr: 1, highwayClass: 1, _id: 0 })
    .toArray();

  const features = units.map((u) => {
    const r = byId.get(u.unitId);
    return {
      type: 'Feature',
      geometry: thinGeometry(u.geometry),
      properties: {
        // id + score only: everything else comes from the detail endpoint
        id: u.unitId,
        s: r ? Math.round(r.riskScore * 100) : null,
        b: r?.riskBand ?? 'insufficient_data',
      },
    };
  });

  return writeJson('segments.geojson', { type: 'FeatureCollection', features });
}

async function exportGreen(d) {
  const units = await d
    .collection(collections.units)
    .find({ unitType: { $in: ['green', 'ring'] }, active: true })
    .project({ unitId: 1, unitType: 1, parentUnitId: 1, nameAr: 1, geometry: 1,
               areaM2: 1, qaFlags: 1, _id: 0 })
    .toArray();

  const features = units.map((u) => ({
    type: 'Feature',
    geometry: thinGeometry(u.geometry),
    properties: {
      id: u.unitId,
      t: u.unitType,
      parent: u.parentUnitId ?? null,
      name: u.nameAr ?? null,
      area: u.areaM2 ?? null,
      // honesty travels with the geometry: the UI greys these out
      small: Boolean(u.qaFlags?.ringTooSmall),
    },
  }));

  return writeJson('green.geojson', { type: 'FeatureCollection', features });
}

async function exportWasteEvents(d) {
  const events = await d
    .collection(collections.wasteEvents)
    .find({})
    .sort({ severityScore: -1 })
    .limit(500)
    .project({ _id: 0 })
    .toArray();
  return writeJson('waste-events.json', { items: events, count: events.length });
}

async function exportSegmentDetails(d) {
  const risk = await d
    .collection(collections.segmentRisk)
    .find({})
    .sort({ riskScore: -1 })
    .limit(300)
    .project({ _id: 0 })
    .toArray();

  const ids = risk.map((r) => r.segmentUnitId);
  const units = await d
    .collection(collections.units)
    .find({ unitId: { $in: ids } })
    .project({ unitId: 1, nameAr: 1, highwayClass: 1, lengthM: 1, centroid: 1,
               dtmConfidence: 1, sarVisibility: 1, _id: 0 })
    .toArray();
  const byId = new Map(units.map((u) => [u.unitId, u]));

  const items = risk.map((r) => ({ ...r, unit: byId.get(r.segmentUnitId) ?? null }));
  return writeJson('segments-top.json', { items, count: items.length });
}

async function exportRain(d) {
  const events = await d
    .collection(collections.rainEvents)
    .find({})
    .sort({ peakDate: -1 })
    .project({ _id: 0 })
    .toArray();

  const recent = await d
    .collection(collections.weatherDaily)
    .find({})
    .sort({ date: -1 })
    .limit(120)
    .project({ _id: 0 })
    .toArray();

  return writeJson('rain.json', { events, recent: recent.reverse() });
}

async function exportMeta(d) {
  const counts = await d
    .collection(collections.units)
    .aggregate([{ $group: { _id: '$unitType', n: { $sum: 1 } } }])
    .toArray();

  const lastRuns = await d
    .collection(collections.pipelineRuns)
    .find({})
    .sort({ startedAt: -1 })
    .limit(12)
    .project({ _id: 0 })
    .toArray();

  const [obsCount, wasteCount, pondCount] = await Promise.all([
    d.collection(collections.observations).countDocuments(),
    d.collection(collections.wasteEvents).countDocuments(),
    d.collection(collections.pondingObservations).countDocuments(),
  ]);

  const latestObs = await d
    .collection(collections.observations)
    .find({})
    .sort({ obsDate: -1 })
    .limit(1)
    .project({ obsDate: 1, sensor: 1, _id: 0 })
    .toArray();

  return writeJson('meta.json', {
    generatedAt: new Date().toISOString(),
    aoi: config.aoi,
    units: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    observations: obsCount,
    wasteEvents: wasteCount,
    pondingObservations: pondCount,
    latestObservation: latestObs[0] ?? null,
    pipelineRuns: lastRuns,
    // surfaced in the UI so a viewer always knows how fresh the data is
    dataMode: 'precomputed',
  });
}

export async function exportStatic() {
  const d = await connect();
  console.log(`  writing to ${OUT()}`);
  let total = 0;
  total += await exportMeta(d);
  total += await exportGreen(d);
  total += await exportSegments(d);
  total += await exportSegmentDetails(d);
  total += await exportWasteEvents(d);
  total += await exportRain(d);
  console.log(`\n  total payload: ${(total / 1024).toFixed(1)} MB uncompressed ` +
              `(gzip on the wire is roughly a quarter of that)`);
  return total;
}
