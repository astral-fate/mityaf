/**
 * Give every green asset a human name.
 *
 * OpenStreetMap knows what these things are — leisure=park, landuse=grass,
 * leisure=pitch — but buildGreen only kept the geometry, so an unnamed asset
 * rendered as "أصل أخضر grn_1455936590". An operator cannot act on an id, and
 * a park, a sports pitch and a roadside planting strip need entirely different
 * interventions when their vegetation fails.
 *
 * This reads the cached Overpass response and UPDATEs existing rows by OSM id.
 * It deliberately does not rebuild geometry: the rings, the district stamps and
 * the observation history are all keyed to the current unit ids, and none of
 * that should be disturbed to add a label.
 */
import { query } from './db.js';
import { fetchLayer } from './osm.js';

/**
 * Ordered most specific first. A way tagged both leisure=park and
 * landuse=grass is a park — the leisure tag states the function, the landuse
 * tag only states the surface.
 */
/**
 * Whether the kind is SUPPOSED to be vegetated.
 *
 * 182 of Madinah's 324 green polygons are ملاعب, and a Saudi neighbourhood
 * pitch is very often compacted sand by design. It reads NDVI 0.086 because
 * it is sand, not because anything died — and 97 of the 147 "bare" verdicts
 * were exactly that. Grouping them with failed parks buried the real finding,
 * which is that 10 of 15 tree belts have no canopy.
 */
const KINDS = [
  { test: (t) => t.leisure === 'park', key: 'park', expectsVegetation: true, ar: 'حديقة عامة' },
  { test: (t) => t.leisure === 'garden', key: 'garden', expectsVegetation: true, ar: 'حديقة' },
  { test: (t) => t.leisure === 'pitch', key: 'pitch', ar: 'ملعب', expectsVegetation: false },
  { test: (t) => t.landuse === 'forest', key: 'forest', expectsVegetation: true, ar: 'حزام شجري' },
  { test: (t) => t.landuse === 'village_green', key: 'village_green', expectsVegetation: true, ar: 'ساحة خضراء' },
  { test: (t) => t.landuse === 'recreation_ground', key: 'recreation', expectsVegetation: true, ar: 'أرض ترفيهية' },
  { test: (t) => t.landuse === 'grass', key: 'grass', expectsVegetation: true, ar: 'مسطّح عشبي' },
];

export function deriveKind(tags = {}) {
  const hit = KINDS.find((k) => k.test(tags));
  if (hit) return { key: hit.key, ar: hit.ar, expectsVegetation: hit.expectsVegetation !== false };
  return { key: 'green_area', ar: 'مساحة خضراء', expectsVegetation: true };
}

/**
 * A pitch is irrigated turf under heavy wear; a forest belt is planted trees;
 * a grass strip beside a road is street planting. When vegetation fails, the
 * intervention differs, so the kind is worth stating on its own.
 */
export function displayName({ nameAr, kindAr, districtAr }) {
  if (nameAr) return nameAr;
  return districtAr ? `${kindAr} — حي ${districtAr}` : kindAr;
}

export async function labelAssets() {
  const data = await fetchLayer('green');

  const byOsm = new Map();
  for (const el of data.elements ?? []) {
    if (el.type !== 'way') continue;
    byOsm.set(String(el.id), el.tags ?? {});
  }
  console.log(`  ${byOsm.size} tagged ways in the cached OSM response`);

  const { rows } = await query(
    `SELECT unit_id, source_ref, name_ar, district_ar
       FROM units WHERE unit_type = 'green' AND active`);

  const updates = rows.map((r) => {
    const kind = deriveKind(byOsm.get(String(r.source_ref)) ?? {});
    return {
      unitId: r.unit_id,
      kindKey: kind.key,
      kindAr: kind.ar,
      display: displayName({ nameAr: r.name_ar, kindAr: kind.ar, districtAr: r.district_ar }),
    };
  });

  // One statement with a VALUES join rather than 324 round trips.
  const values = updates
    .map((u, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    .join(', ');
  const params = updates.flatMap((u) => [u.unitId, u.kindKey, u.kindAr, u.display]);

  const { rowCount } = await query(
    `UPDATE units u
        SET asset_kind = v.kind_key,
            asset_kind_ar = v.kind_ar,
            display_name_ar = v.display
       FROM (VALUES ${values}) AS v(unit_id, kind_key, kind_ar, display)
      WHERE u.unit_id = v.unit_id`,
    params,
  );

  const tally = updates.reduce((a, u) => ({ ...a, [u.kindAr]: (a[u.kindAr] ?? 0) + 1 }), {});
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(16)} ${n}`);
  }
  const named = rows.filter((r) => r.name_ar).length;
  console.log(`  ${rowCount} labelled · ${named} had a real OSM name, `
    + `${rowCount - named} now named by kind and district`);
  return { labelled: rowCount, named };
}
