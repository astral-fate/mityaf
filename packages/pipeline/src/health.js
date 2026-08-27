/**
 * Vegetation health per green asset.
 *
 * Two indices, and the value is in their disagreement.
 *
 *   NDVI  — greenness and biomass. Falls once a plant is already visibly gone.
 *   NDMI  — canopy water content, from B8A/B11. Falls *first*, while the
 *           canopy still looks green.
 *
 * A gardener walking past sees NDVI. The satellite sees NDMI too, and the gap
 * between them is the warning: moisture dropping under a canopy that still
 * reads green is an irrigation failure caught weeks before anything browns.
 * That is the only part of this worth building, and it is why the classifier
 * looks at both series rather than thresholding greenness alone.
 *
 * Two honesty rules are load-bearing:
 *  - A trend from three cloud-free looks is not a trend. Below MIN_OBS the
 *    verdict is `insufficient_data`, never `healthy`. An asset we could not
 *    see is never reported as fine.
 *  - NDMI is 20 m native while NDVI is 10 m. A small garden can be a single
 *    mixed NDMI pixel, so `ndmiReliable` is recorded per asset and the water
 *    stress verdict is withheld where it is false.
 */
import { bulkUpsert, query } from './db.js';

// Arid-city calibration. Irrigated turf and palm canopy in Madinah sit well
// above bare desert soil, which is what makes the separation tractable here.
const BARE_SOIL_NDVI = 0.15;   // below this there is effectively no canopy
const SPARSE_NDVI = 0.25;      // stressed or patchy
const MIN_OBS = 6;             // fewer looks than this cannot carry a trend
const NDMI_MIN_AREA_M2 = 1600; // 4 x 4 pixels at 20 m; below this NDMI is mixed
const DECLINE_PER_YEAR = -0.06; // NDVI slope that counts as a real decline

/** Ordinary least squares slope, in index units per year. */
export function slopePerYear(points) {
  const n = points.length;
  if (n < 3) return null;
  const t0 = points[0].t;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (const p of points) {
    const x = (p.t - t0) / 3.1536e10;   // ms -> years
    sx += x; sy += p.v; sxx += x * x; sxy += x * p.v;
  }
  const d = n * sxx - sx * sx;
  if (Math.abs(d) < 1e-12) return null;
  return (n * sxy - sx * sy) / d;
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Classify one asset from its own history.
 * Returns a verdict plus the reason, because a verdict a gardener cannot
 * argue with is a verdict nobody acts on.
 */
export function classify({ ndvi, ndmi, areaM2 }) {
  const nd = ndvi.map((p) => p.v);
  const ndviMedian = median(nd);
  const ndviSlope = slopePerYear(ndvi);
  const ndmiSlope = slopePerYear(ndmi);
  const ndmiReliable = areaM2 >= NDMI_MIN_AREA_M2 && ndmi.length >= MIN_OBS;

  if (ndvi.length < MIN_OBS || ndviMedian === null) {
    return {
      status: 'insufficient_data',
      ndviMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: `عدد الأرصاد الصافية ${ndvi.length} — أقل من ${MIN_OBS}، لا يكفي للحكم`,
    };
  }

  if (ndviMedian < BARE_SOIL_NDVI) {
    return {
      status: 'dead',
      ndviMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: `الغطاء النباتي عند مستوى التربة العارية (NDVI ${ndviMedian.toFixed(2)})`,
    };
  }

  if (ndviSlope !== null && ndviSlope <= DECLINE_PER_YEAR) {
    return {
      status: 'declining',
      ndviMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: `اتجاه هابط في الخضرة بمقدار ${Math.abs(ndviSlope).toFixed(2)} سنوياً`,
    };
  }

  // The early warning: moisture leaving a canopy that still reads green.
  if (ndmiReliable && ndmiSlope !== null && ndmiSlope <= DECLINE_PER_YEAR
      && ndviMedian >= SPARSE_NDVI) {
    return {
      status: 'water_stress',
      ndviMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: 'رطوبة المظلة تنخفض والخضرة ما زالت مرتفعة — إجهاد ريّ قبل ظهوره للعين',
    };
  }

  if (ndviMedian < SPARSE_NDVI) {
    return {
      status: 'sparse',
      ndviMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: `غطاء نباتي متفرّق (NDVI ${ndviMedian.toFixed(2)})`,
    };
  }

  return {
    status: 'healthy',
    ndviMedian, ndviSlope, ndmiSlope, ndmiReliable,
    reasonAr: `خضرة مستقرة (NDVI ${ndviMedian.toFixed(2)})`,
  };
}

export async function buildHealth({ months = 12 } = {}) {
  const since = new Date(Date.now() - months * 30 * 864e5).toISOString().slice(0, 10);

  // Only clean looks. A cloud-shadowed reading is a low NDVI that means
  // nothing, and averaging it in manufactures decline that is not there.
  const { rows } = await query(
    `SELECT o.unit_id, o.obs_date, o.ndvi, o.ndmi,
            u.name_ar, u.district_ar, u.area_m2
       FROM observations o
       JOIN units u ON u.unit_id = o.unit_id
      WHERE u.unit_type = 'green' AND u.active
        AND o.sensor = 'S2' AND o.obs_date >= $1
        AND o.quality_flag = 'ok'
      ORDER BY o.unit_id, o.obs_date`,
    [since],
  );

  if (!rows.length) {
    console.log('  no clean S2 observations over green assets — run backfill-s2 first');
    return { assets: 0 };
  }

  const byUnit = new Map();
  for (const r of rows) {
    let u = byUnit.get(r.unit_id);
    if (!u) {
      u = { unitId: r.unit_id, nameAr: r.name_ar, districtAr: r.district_ar,
            areaM2: Number(r.area_m2) || 0, ndvi: [], ndmi: [] };
      byUnit.set(r.unit_id, u);
    }
    const t = new Date(r.obs_date).getTime();
    if (r.ndvi !== null) u.ndvi.push({ t, v: Number(r.ndvi) });
    if (r.ndmi !== null) u.ndmi.push({ t, v: Number(r.ndmi) });
  }

  const out = [];
  for (const u of byUnit.values()) {
    const v = classify(u);
    out.push({
      green_unit_id: u.unitId,
      assessed_on: new Date().toISOString().slice(0, 10),
      status: v.status,
      ndvi_median: v.ndviMedian,
      ndvi_slope_yr: v.ndviSlope,
      ndmi_slope_yr: v.ndmiSlope,
      ndmi_reliable: v.ndmiReliable,
      n_observations: u.ndvi.length,
      reason_ar: v.reasonAr,
    });
  }

  await bulkUpsert({
    table: 'green_health',
    columns: ['green_unit_id', 'assessed_on', 'status', 'ndvi_median', 'ndvi_slope_yr',
      'ndmi_slope_yr', 'ndmi_reliable', 'n_observations', 'reason_ar'],
    rows: out,
    conflictTarget: ['green_unit_id', 'assessed_on'],
  });

  const tally = out.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(18)} ${n}`);
  }
  return { assets: out.length, tally };
}
