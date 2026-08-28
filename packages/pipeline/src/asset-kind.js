/**
 * Give every green asset a human name, and decide whether it can be judged.
 *
 * OpenStreetMap knows what these things are — leisure=park, landuse=grass,
 * leisure=pitch — but buildGreen only kept the geometry, so an unnamed asset
 * rendered as "أصل أخضر grn_1455936590". An operator cannot act on an id, and
 * a park, a basketball court and a roadside planting strip need entirely
 * different interventions when their vegetation fails.
 *
 * Three separate questions are answered here, and keeping them separate is the
 * whole point:
 *
 *   what is it        — the kind, from the OSM tags plus the shape
 *   should it be green — `expectsVegetation`; a tennis court should not
 *   can we even see it — `subPixel`; a 5 m planting strip is narrower than one
 *                        Sentinel-2 pixel, so its NDVI is mostly the asphalt
 *                        beside it
 *
 * Collapsing the second and third into one "bare" verdict is how a remote
 * sensing product ends up telling a municipality that 147 of its green assets
 * are dead when most of them are sand pitches and kerbside strips.
 *
 * This reads the cached Overpass response and UPDATEs existing rows by OSM id.
 * It deliberately does not rebuild geometry: the rings, the district stamps and
 * the observation history are all keyed to the current unit ids, and none of
 * that should be disturbed to add a label.
 */
import { query } from './db.js';
import { fetchLayer } from './osm.js';

/**
 * One Sentinel-2 pixel is 10 m. A polygon whose effective width is under that
 * cannot produce a vegetation index of its own — whatever the strip is doing,
 * the reading belongs mostly to the road next to it. Measured, not assumed:
 * 49 of Madinah's 324 assets fall here, and 28 of them were being reported as
 * "bare".
 */
export const SUBPIXEL_WIDTH_M = 10;

/**
 * Above one pixel but still ribbon-shaped is street planting rather than a
 * lawn. 12 m separates them cleanly in Madinah: no park and no tree belt in
 * the city is narrower than that, while the median grass polygon is 5.5 m.
 */
const VERGE_WIDTH_M = 12;

/**
 * Hard courts are asphalt or acrylic by design. Assessing them for greenness
 * is not a measurement, it is a category error — and it was manufacturing 35
 * false "bare" verdicts.
 */
const HARD_COURT_SPORTS = new Set([
  'basketball', 'tennis', 'netball', 'skateboard', 'handball', 'padel', 'squash',
]);

const SPORT_AR = {
  soccer: 'كرة قدم',
  basketball: 'كرة سلة',
  tennis: 'تنس',
  volleyball: 'كرة طائرة',
  netball: 'كرة شبكة',
  skateboard: 'تزلّج',
  handball: 'كرة يد',
  multi: 'متعدّد الرياضات',
};

/**
 * The registry, so that "is this supposed to be green?" has exactly one
 * answer in the codebase. export.js used to re-derive it as
 * `asset_kind !== 'pitch'`, which silently disagreed the moment courts and
 * verges existed.
 */
export const KIND_META = {
  park:          { ar: 'حديقة عامة',      expectsVegetation: true },
  garden:        { ar: 'حديقة',           expectsVegetation: true },
  forest:        { ar: 'حزام شجري',       expectsVegetation: true },
  village_green: { ar: 'ساحة خضراء',      expectsVegetation: true },
  recreation:    { ar: 'أرض ترفيهية',     expectsVegetation: true },
  lawn:          { ar: 'مسطّح عشبي',      expectsVegetation: true },
  verge:         { ar: 'شريط تشجير',      expectsVegetation: true },
  // Street trees. The single largest class OSM holds for Madinah, and the one
  // a maintenance crew is most often dispatched to.
  tree_row:      { ar: 'صف أشجار شوارع',  expectsVegetation: true },
  // Date palm groves: the heaviest irrigation draw in the city, and until now
  // entirely absent from the inventory.
  orchard:       { ar: 'بستان نخيل',      expectsVegetation: true },
  wood:          { ar: 'أشجار كثيفة',     expectsVegetation: true },
  scrub:         { ar: 'شجيرات',          expectsVegetation: true },
  grassland:     { ar: 'أرض عشبية',       expectsVegetation: true },
  meadow:        { ar: 'مرج',             expectsVegetation: true },
  allotments:    { ar: 'مزارع صغيرة',     expectsVegetation: true },
  nursery:       { ar: 'مشتل',            expectsVegetation: true },
  golf:          { ar: 'ملعب غولف',       expectsVegetation: true },
  reserve:       { ar: 'محمية طبيعية',    expectsVegetation: true },
  common:        { ar: 'ساحة عامة',       expectsVegetation: true },
  pitch:         { ar: 'ملعب',            expectsVegetation: false },
  court:         { ar: 'ملعب صلب',        expectsVegetation: false },
  // Sand or rubber matting by design in this city, like a neighbourhood pitch.
  playground:    { ar: 'ملعب أطفال',      expectsVegetation: false },
  // Land held for development, not planted — low NDVI is the expected state.
  greenfield:    { ar: 'أرض بيضاء',       expectsVegetation: false },
  cemetery:      { ar: 'مقبرة',           expectsVegetation: false },
  green_area:    { ar: 'مساحة خضراء',     expectsVegetation: true },
};

export function kindMeta(key) {
  return KIND_META[key] ?? KIND_META.green_area;
}

/** Effective width of a ribbon: 2·area/perimeter is its short side. */
export function effectiveWidth(areaM2, perimeterM) {
  if (!(areaM2 > 0) || !(perimeterM > 0)) return null;
  return (2 * areaM2) / perimeterM;
}

/**
 * @param tags  OSM tags
 * @param geom  optional { areaM2, perimeterM } — without it, shape-derived
 *              kinds (verge vs lawn) and subPixel cannot be decided, and the
 *              caller gets the tag-only answer rather than a guess.
 */
export function deriveKind(tags = {}, geom = {}) {
  const width = effectiveWidth(geom.areaM2, geom.perimeterM);
  const sport = tags.sport;

  let key;
  if (tags.leisure === 'pitch') {
    key = HARD_COURT_SPORTS.has(sport) ? 'court' : 'pitch';
  } else if (tags.leisure === 'park') key = 'park';
  else if (tags.leisure === 'garden') key = 'garden';
  else if (tags.leisure === 'playground') key = 'playground';
  else if (tags.leisure === 'golf_course') key = 'golf';
  else if (tags.leisure === 'nature_reserve') key = 'reserve';
  else if (tags.leisure === 'common' || tags.leisure === 'dog_park') key = 'common';
  // natural=* is checked before landuse=*: a way tagged both natural=tree_row
  // and landuse=grass is a line of trees, and the landuse tag only describes
  // what is underneath them.
  else if (tags.natural === 'tree_row') key = 'tree_row';
  else if (tags.natural === 'wood') key = 'wood';
  else if (tags.natural === 'scrub') key = 'scrub';
  else if (tags.natural === 'grassland') key = 'grassland';
  else if (tags.landuse === 'forest') key = 'forest';
  else if (tags.landuse === 'orchard') key = 'orchard';
  else if (tags.landuse === 'meadow') key = 'meadow';
  else if (tags.landuse === 'allotments') key = 'allotments';
  else if (tags.landuse === 'plant_nursery') key = 'nursery';
  else if (tags.landuse === 'greenfield') key = 'greenfield';
  else if (tags.landuse === 'cemetery' || tags.amenity === 'grave_yard') key = 'cemetery';
  else if (tags.landuse === 'village_green') key = 'village_green';
  else if (tags.landuse === 'recreation_ground') key = 'recreation';
  else if (tags.landuse === 'grass') {
    // A ribbon of grass along a road is street planting, not a lawn, and the
    // crew sent to it carries different equipment.
    key = width !== null && width < VERGE_WIDTH_M ? 'verge' : 'lawn';
  } else key = 'green_area';

  const meta = kindMeta(key);
  // Name the sport when OSM states it: "ملعب كرة سلة" is actionable in a way
  // that "ملعب" is not.
  const ar = (key === 'pitch' || key === 'court') && SPORT_AR[sport]
    ? `ملعب ${SPORT_AR[sport]}`
    : meta.ar;

  return {
    key,
    ar,
    expectsVegetation: meta.expectsVegetation,
    widthM: width,
    // Two independent reasons the greenness reading is not trustworthy.
    hardSurface: key === 'court',
    subPixel: width !== null && width < SUBPIXEL_WIDTH_M,
  };
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

/**
 * Stamp each green asset with the nearest named street.
 *
 * A district is not an address. "حديقة عامة — حي الجامعة" identifies 39
 * different assets, so a crew handed that row still has to go looking — which
 * is the exact behaviour the platform exists to remove. The nearest named
 * street plus a distance turns the row into somewhere a driver can be sent.
 *
 * The distance is kept rather than discarded: a street 400 m away is not the
 * asset's address, and the UI needs to be able to say so instead of implying
 * a precision that is not there.
 */
export async function enrichStreets() {
  // <-> is the GIST distance operator, so the LATERAL picks the nearest
  // candidate by index rather than measuring against all 30,337 segments.
  const { rowCount } = await query(
    `WITH nearest AS (
       SELECT g.unit_id,
              s.name_ar AS street,
              ST_Distance(g.geom::geography, s.geom::geography) AS d
         FROM units g
         CROSS JOIN LATERAL (
           SELECT name_ar, geom
             FROM units s
            WHERE s.unit_type = 'segment' AND s.active AND s.name_ar IS NOT NULL
            ORDER BY s.geom <-> g.geom
            LIMIT 1
         ) s
        WHERE g.unit_type = 'green' AND g.active
     )
     UPDATE units u
        SET nearest_street_ar = n.street,
            nearest_street_m  = round(n.d::numeric, 0)
       FROM nearest n
      WHERE u.unit_id = n.unit_id`);

  const { rows: near } = await query(
    `SELECT count(*) FILTER (WHERE nearest_street_m <= 100)::int AS close,
            count(*) FILTER (WHERE nearest_street_ar IS NOT NULL)::int AS any
       FROM units WHERE unit_type = 'green' AND active`);
  console.log(`  streets : ${rowCount} assets stamped · ${near[0].close} within 100 m `
    + `of a named street`);
  return { stamped: rowCount, within100m: near[0].close };
}

export async function labelAssets() {
  const data = await fetchLayer('green');

  const byOsm = new Map();
  for (const el of data.elements ?? []) {
    if (el.type !== 'way') continue;
    byOsm.set(String(el.id), el.tags ?? {});
  }
  console.log(`  ${byOsm.size} tagged ways in the cached OSM response`);

  // Perimeter comes from PostGIS rather than from re-parsing the OSM geometry:
  // it is the same number the rest of the pipeline measures with, and it is
  // geodesic, so it stays right in metres without a projection step.
  const { rows } = await query(
    `SELECT unit_id, source_ref, name_ar, district_ar,
            ST_Area(geom::geography)      AS area_m2,
            ST_Perimeter(geom::geography) AS perim_m
       FROM units WHERE unit_type = 'green' AND active`);

  const updates = rows.map((r) => {
    const kind = deriveKind(byOsm.get(String(r.source_ref)) ?? {}, {
      areaM2: Number(r.area_m2) || 0,
      perimeterM: Number(r.perim_m) || 0,
    });
    return {
      unitId: r.unit_id,
      kindKey: kind.key,
      kindAr: kind.ar,
      widthM: kind.widthM,
      subPixel: kind.subPixel,
      hardSurface: kind.hardSurface,
      display: displayName({ nameAr: r.name_ar, kindAr: kind.ar, districtAr: r.district_ar }),
    };
  });

  // One statement with a VALUES join rather than 324 round trips.
  const values = updates
    .map((u, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}::double precision)`)
    .join(', ');
  const params = updates.flatMap((u) => [u.unitId, u.kindKey, u.kindAr, u.display, u.widthM]);

  const { rowCount } = await query(
    `UPDATE units u
        SET asset_kind        = v.kind_key,
            asset_kind_ar     = v.kind_ar,
            display_name_ar   = v.display,
            effective_width_m = v.width_m
       FROM (VALUES ${values}) AS v(unit_id, kind_key, kind_ar, display, width_m)
      WHERE u.unit_id = v.unit_id`,
    params,
  );

  const tally = updates.reduce((a, u) => ({ ...a, [u.kindAr]: (a[u.kindAr] ?? 0) + 1 }), {});
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(20)} ${n}`);
  }
  const named = rows.filter((r) => r.name_ar).length;
  const sub = updates.filter((u) => u.subPixel).length;
  const hard = updates.filter((u) => u.hardSurface).length;
  console.log(`  ${rowCount} labelled · ${named} had a real OSM name, `
    + `${rowCount - named} now named by kind and district`);
  console.log(`  ${sub} narrower than one S2 pixel · ${hard} hard-surface courts `
    + `— both excluded from vegetation verdicts`);
  return { labelled: rowCount, named, subPixel: sub, hardSurface: hard };
}
