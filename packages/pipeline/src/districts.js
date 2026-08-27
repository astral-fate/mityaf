/**
 * District boundaries for Al Madinah — derived, and labelled as derived.
 *
 * The city's districts exist in OpenStreetMap as 91 named POINTS tagged
 * place=neighbourhood. There is not a single boundary polygon: no
 * admin_level=10 relations, no closed ways. So "filter by district" cannot be
 * answered by importing geometry, because the geometry does not exist.
 *
 * What we do instead is tessellate: every location belongs to the district
 * whose centre point is nearest. That is a Voronoi diagram, and it is exactly
 * how a resident answers the question — you are in الحرة الشرقية because that
 * is the district you are nearest the middle of. It is a good approximation
 * and a bad survey, and the difference matters at the edges where two
 * districts meet, so every derived polygon is stamped
 * `boundary_source = 'voronoi'` and the UI says so.
 *
 * The moment the Amanah supplies real boundaries — including by dropping a
 * file into the dashboard — they replace these.
 */
import * as turf from '@turf/turf';

import { bboxArray, config } from './config.js';
import { bulkUpsert, query } from './db.js';
import { fetchLayer } from './osm.js';

/** Pull the district centre points, keeping only those inside the AOI. */
export function districtPoints(data) {
  const out = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags['name:ar'] ?? tags.name;
    if (!name) continue;

    // `out tags center` gives nodes a lat/lon and ways/relations a `center`.
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) continue;

    const a = config.aoi;
    if (lon < a.minLon || lon > a.maxLon || lat < a.minLat || lat > a.maxLat) continue;

    out.push({
      id: `dst_${el.type[0]}${el.id}`,
      nameAr: name,
      nameEn: tags['name:en'] ?? null,
      lon,
      lat,
    });
  }
  return out;
}

/**
 * Voronoi cells over the AOI, one per district point.
 *
 * turf.voronoi returns cells in the same order as the input points but may
 * emit null for a degenerate cell, so the pairing is by index and the nulls
 * are dropped rather than shifting every later district onto the wrong name.
 */
export function tessellate(points) {
  const fc = turf.featureCollection(
    points.map((p) => turf.point([p.lon, p.lat], { id: p.id })),
  );
  const cells = turf.voronoi(fc, { bbox: bboxArray() });

  const out = [];
  cells.features.forEach((cell, i) => {
    const p = points[i];
    if (!cell || !p) return;
    // Clip: voronoi already honours the bbox, but a cell can still carry a
    // vertex a hair outside it, which Postgres will reject as invalid.
    const clipped = turf.intersect(
      turf.featureCollection([turf.polygon(cell.geometry.coordinates), turf.bboxPolygon(bboxArray())]),
    );
    const geom = clipped?.geometry ?? cell.geometry;
    out.push({
      ...p,
      geometry: geom,
      areaKm2: turf.area(turf.feature(geom)) / 1e6,
    });
  });
  return out;
}

export async function buildDistricts({ refresh = false } = {}) {
  const raw = await fetchLayer('districts', { refresh });
  const points = districtPoints(raw);
  if (!points.length) throw new Error('no district points found inside the AOI');
  console.log(`  ${points.length} district centres inside the AOI`);

  const cells = tessellate(points);
  console.log(`  ${cells.length} Voronoi cells built`);

  await bulkUpsert({
    table: 'units',
    columns: ['unit_id', 'unit_type', 'name_ar', 'name_en', 'district_ar',
      'source', 'source_ref', 'geom', 'centroid', 'area_m2',
      'geometry_confidence', 'qa_flags'],
    conflictTarget: ['unit_id'],
    rows: cells.map((c) => ({
      unit_id: c.id,
      unit_type: 'district',
      name_ar: c.nameAr,
      name_en: c.nameEn,
      district_ar: c.nameAr,          // a district is its own district
      source: 'osm',
      source_ref: c.id,
      // SRID must be stamped on: a geometry at SRID 0 will not compare
      // against the 4326 columns it is meant to contain.
      geom: {
        sql: 'ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)',
        value: JSON.stringify(c.geometry),
      },
      centroid: {
        sql: 'ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)',
        value: JSON.stringify({ type: 'Point', coordinates: [c.lon, c.lat] }),
      },
      area_m2: Math.round(c.areaKm2 * 1e6),
      // A tessellation is not a survey, and the record should say so on its
      // own rather than relying on anyone remembering how it was built.
      geometry_confidence: 'low',
      qa_flags: JSON.stringify({
        boundarySource: 'voronoi',
        centre: [c.lon, c.lat],
        note: 'مشتقّ من نقاط مراكز الأحياء — ليس حدوداً رسمية',
      }),
    })),
  });

  // Stamp every other unit with the district containing its centroid. One
  // statement rather than a round trip per unit: 30k segments would otherwise
  // be 30k queries.
  const { rowCount } = await query(`
    UPDATE units u
       SET district_ar = d.name_ar
      FROM units d
     WHERE d.unit_type = 'district'
       AND u.unit_type <> 'district'
       AND ST_Contains(d.geom, ST_PointOnSurface(u.geom))
  `);
  console.log(`  assigned a district to ${rowCount.toLocaleString('en-US')} units`);

  const { rows } = await query(`
    SELECT district_ar, count(*)::int AS n
      FROM units
     WHERE unit_type <> 'district' AND district_ar IS NOT NULL
     GROUP BY district_ar ORDER BY n DESC LIMIT 6
  `);
  for (const r of rows) console.log(`    ${r.district_ar}: ${r.n}`);

  const { rows: orphan } = await query(
    `SELECT count(*)::int AS n FROM units WHERE unit_type <> 'district' AND district_ar IS NULL`,
  );
  if (orphan[0].n) console.log(`  ${orphan[0].n} units fell outside every cell`);

  return { districts: cells.length, assigned: rowCount };
}
