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
 * Four honesty rules are load-bearing:
 *  - A trend from three cloud-free looks is not a trend. Below MIN_OBS the
 *    verdict is `insufficient_data`, never `healthy`. An asset we could not
 *    see is never reported as fine.
 *  - A *direction* needs far more evidence than a *level*: MIN_OBS_TREND gates
 *    `declining` and `water_stress` separately, because short series produced
 *    slopes that reversed sign once the archive filled in.
 *  - NDMI is 20 m native while NDVI is 10 m. A small garden can be a single
 *    mixed NDMI pixel, so `ndmiReliable` is recorded per asset and the water
 *    stress verdict is withheld where it is false.
 *  - Some assets cannot be judged at all: a hard court has no vegetation by
 *    design, and a planting strip narrower than one 10 m pixel reports the
 *    road beside it. Both return `not_assessable` rather than `bare`.
 */
import { bulkUpsert, query } from './db.js';
import { SUBPIXEL_WIDTH_M, kindMeta } from './asset-kind.js';

/**
 * Severity of each verdict as a work item, not as a description.
 *
 * `water_stress` outranks `bare` on purpose: it is the only verdict with a
 * window still open. A canopy losing moisture can be saved by fixing a valve
 * this week; ground that has never carried vegetation is a planting decision
 * for next season, and a healthy asset needs nothing.
 */
const SEVERITY = {
  dead: 100,
  water_stress: 90,
  declining: 70,
  bare: 45,
  sparse: 20,
  healthy: 0,
  insufficient_data: 0,
  not_assessable: 0,
};

const ACTION_AR = {
  dead: 'استبدال الغطاء وفحص شبكة الري — فقد الأصل غطاءه خلال فترة الرصد',
  water_stress: 'فحص الري خلال أسبوع — الرطوبة تنخفض والخضرة ما زالت ظاهرة للعين',
  declining: 'زيارة ميدانية لتحديد سبب التراجع قبل أن يصل إلى الفقد',
  bare: 'لا غطاء مرصود — يُراجع التصنيف أو يُدرَج ضمن خطة التشجير',
  sparse: 'متابعة في الدورة القادمة',
  healthy: 'لا إجراء',
  insufficient_data: 'لا حكم — أرصاد صافية غير كافية',
  not_assessable: 'خارج نطاق التقييم بالأقمار الصناعية',
};

/**
 * Rank the work list. Severity dominates; area breaks ties, because a hectare
 * of failing park and a 200 m² verge are not the same call-out even when they
 * carry the same verdict. Log area so one large park cannot outrank every
 * genuinely dying asset in the city.
 */
export function priorityOf({ status, areaM2, expectsVegetation }) {
  const sev = SEVERITY[status] ?? 0;
  if (!sev) return 0;
  // An asset nobody planted on purpose is a lower call on the crew than a
  // park that is supposed to be green and is not.
  const intent = expectsVegetation ? 1 : 0.25;
  const size = Math.log10(Math.max(areaM2, 100) / 100) / 3; // 100 m² -> 0, 100k m² -> 1
  return Math.round(sev * intent * (0.7 + 0.3 * Math.min(size, 1)) * 10) / 10;
}

// Arid-city calibration. Irrigated turf and palm canopy in Madinah sit well
// above bare desert soil, which is what makes the separation tractable here.
const BARE_SOIL_NDVI = 0.15;   // below this there is effectively no canopy
const SPARSE_NDVI = 0.25;      // stressed or patchy
const MIN_OBS = 6;             // fewer looks than this cannot carry a median
/**
 * A median is stable from a handful of looks; an OLS slope is not.
 *
 * This threshold is not a guess. An earlier run classified 15 assets as
 * `water_stress` from a series averaging 41 observations. After the S2
 * backfill completed and the same assets carried ~103 observations each,
 * every one of those 15 came back `healthy` — their NDMI slopes had flipped
 * positive. The decline was noise the fit was too short to reject, and it was
 * being reported to the Amanah as an irrigation fault.
 *
 * So trend-based verdicts (declining, water_stress) now need their own, much
 * higher bar than median-based ones. Below it the asset is described by its
 * level, never by a direction.
 */
const MIN_OBS_TREND = 20;
const NDMI_MIN_AREA_M2 = 1600; // 4 x 4 pixels at 20 m; below this NDMI is mixed
const DECLINE_PER_YEAR = -0.06; // NDVI slope that counts as a real decline
const WAS_VEGETATED_NDVI = 0.30; // proof the ground was once genuinely planted

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
/**
 * Monthly climatology per asset kind, used to deseasonalise before any trend
 * is fitted.
 *
 * Necessary because a single year of data plus an OLS line is a trap. Madinah's
 * date palm groves peak around November and trough in July; a straight line
 * through one cycle whose peak sits early and trough sits late slopes downward
 * even when September and the following August are identical. That artifact
 * classified 95 of 140 orchards as "declining" — 68% of a whole asset class,
 * which is what gave it away.
 *
 * Subtracting the kind's own monthly mean leaves the part that is specific to
 * this asset, so the verdict becomes "declining relative to comparable assets"
 * rather than "declining relative to a line drawn through a season".
 */
export function climatology(units) {
  const byKindMonth = new Map();
  for (const u of units) {
    const kind = u.kindKey ?? 'unknown';
    for (const series of ['ndvi', 'ndmi']) {
      for (const p of u[series]) {
        const month = new Date(p.t).toISOString().slice(0, 7);
        const key = `${kind}|${series}|${month}`;
        if (!byKindMonth.has(key)) byKindMonth.set(key, []);
        byKindMonth.get(key).push(p.v);
      }
    }
  }
  const mean = new Map();
  for (const [key, vals] of byKindMonth) {
    // A monthly mean from two looks is not a climatology; those months fall
    // back to no adjustment rather than to a noisy one.
    if (vals.length < 5) continue;
    mean.set(key, vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return mean;
}

/** Series minus its kind-and-month mean. Points with no climatology pass through. */
export function deseasonalise(points, kindKey, series, clim) {
  return points.map((p) => {
    const m = clim.get(`${kindKey ?? 'unknown'}|${series}|${new Date(p.t).toISOString().slice(0, 7)}`);
    return m === undefined ? p : { t: p.t, v: p.v - m };
  });
}

export function classify({
  ndvi, ndmi, areaM2, widthM = null, kindKey = null,
  ndviAnom = null, ndmiAnom = null,
}) {
  const nd = ndvi.map((p) => p.v);
  const ndviMedian = median(nd);
  const ndviMax = nd.length ? Math.max(...nd) : null;
  const ndmiMedian = median(ndmi.map((p) => p.v));
  // Levels come from the raw series; directions come from the deseasonalised
  // one. Mixing those up is what produced the orchard artifact.
  const ndviSlope = slopePerYear(ndviAnom ?? ndvi);
  const ndmiSlope = slopePerYear(ndmiAnom ?? ndmi);
  const ndmiReliable = areaM2 >= NDMI_MIN_AREA_M2 && ndmi.length >= MIN_OBS_TREND;
  const base = { ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable };

  // Two gates before any greenness is interpreted. Both describe assets whose
  // NDVI is real but does not mean what the classifier would take it to mean,
  // and both used to come out the far end as "bare".
  if (kindKey === 'court') {
    return {
      ...base,
      status: 'not_assessable',
      reasonAr: 'ملعب بسطح صلب بالتصميم — لا يُقيَّم غطاؤه النباتي',
    };
  }
  if (widthM !== null && widthM < SUBPIXEL_WIDTH_M) {
    return {
      ...base,
      status: 'not_assessable',
      reasonAr: `عرضه الفعّال ${widthM.toFixed(1)} م — أضيق من بكسل Sentinel-2 الواحد `
        + '(10 م)، فالقراءة تعود للأسفلت المجاور لا للنبات',
    };
  }

  if (ndvi.length < MIN_OBS || ndviMedian === null) {
    return {
      status: 'insufficient_data',
      ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: `عدد الأرصاد الصافية ${ndvi.length} — أقل من ${MIN_OBS}، لا يكفي للحكم`,
    };
  }

  // Low greenness has two entirely different causes, and conflating them is
  // the difference between a true alarm and an embarrassing one.
  //
  // A park that once read 0.4 and now reads 0.07 lost its planting: that is
  // dead, and it is the alert worth firing. A designated desert park that has
  // read 0.06 for the whole record was never planted — or is scattered date
  // palms over bright sand, where the soil dominates a 10 m pixel and the
  // canopy barely registers. Reporting the second as "ميت" tells the Amanah
  // its parks died when nothing of the sort happened.
  if (ndviMedian < BARE_SOIL_NDVI) {
    const everGreen = ndviMax !== null && ndviMax >= WAS_VEGETATED_NDVI;
    return everGreen
      ? {
        status: 'dead',
        ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable,
        reasonAr: `فقد الغطاء النباتي خلال فترة الرصد — بلغ NDVI ${ndviMax.toFixed(2)} `
          + `ثم انخفض إلى ${ndviMedian.toFixed(2)}`,
      }
      : {
        status: 'bare',
        ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable,
        reasonAr: `لم يُرصد غطاء نباتي طوال فترة الرصد (NDVI ${ndviMedian.toFixed(2)}) — `
          + `أرض غير مزروعة أو نخيل متفرّق فوق رمل يغلب على البكسل`,
      };
  }

  const trendOk = ndvi.length >= MIN_OBS_TREND;

  if (trendOk && ndviSlope !== null && ndviSlope <= DECLINE_PER_YEAR) {
    return {
      status: 'declining',
      ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: `اتجاه هابط في الخضرة بمقدار ${Math.abs(ndviSlope).toFixed(2)} سنوياً`,
    };
  }

  // The early warning: moisture leaving a canopy that still reads green.
  if (trendOk && ndmi.length >= MIN_OBS_TREND
      && ndmiReliable && ndmiSlope !== null && ndmiSlope <= DECLINE_PER_YEAR
      && ndviMedian >= SPARSE_NDVI) {
    return {
      status: 'water_stress',
      ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: 'رطوبة المظلة تنخفض والخضرة ما زالت مرتفعة — إجهاد ريّ قبل ظهوره للعين',
    };
  }

  if (ndviMedian < SPARSE_NDVI) {
    return {
      status: 'sparse',
      ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable,
      reasonAr: `غطاء نباتي متفرّق (NDVI ${ndviMedian.toFixed(2)})`,
    };
  }

  return {
    status: 'healthy',
    ndviMedian, ndviMax, ndmiMedian, ndviSlope, ndmiSlope, ndmiReliable,
    reasonAr: `خضرة مستقرة (NDVI ${ndviMedian.toFixed(2)})`,
  };
}

export async function buildHealth({ months = 12 } = {}) {
  const since = new Date(Date.now() - months * 30 * 864e5).toISOString().slice(0, 10);

  // Only clean looks. A cloud-shadowed reading is a low NDVI that means
  // nothing, and averaging it in manufactures decline that is not there.
  const { rows } = await query(
    `SELECT o.unit_id, o.obs_date, o.ndvi, o.ndmi,
            u.name_ar, u.district_ar, u.area_m2,
            u.asset_kind, u.effective_width_m
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
            areaM2: Number(r.area_m2) || 0,
            kindKey: r.asset_kind,
            widthM: r.effective_width_m === null ? null : Number(r.effective_width_m),
            ndvi: [], ndmi: [] };
      byUnit.set(r.unit_id, u);
    }
    const t = new Date(r.obs_date).getTime();
    if (r.ndvi !== null) u.ndvi.push({ t, v: Number(r.ndvi) });
    if (r.ndmi !== null) u.ndmi.push({ t, v: Number(r.ndmi) });
  }

  const clim = climatology([...byUnit.values()]);
  const out = [];
  for (const u of byUnit.values()) {
    const v = classify({
      ...u,
      ndviAnom: deseasonalise(u.ndvi, u.kindKey, 'ndvi', clim),
      ndmiAnom: deseasonalise(u.ndmi, u.kindKey, 'ndmi', clim),
    });
    const expectsVegetation = kindMeta(u.kindKey).expectsVegetation;
    const priority = priorityOf({ status: v.status, areaM2: u.areaM2, expectsVegetation });
    out.push({
      green_unit_id: u.unitId,
      assessed_on: new Date().toISOString().slice(0, 10),
      status: v.status,
      ndvi_median: v.ndviMedian,
      ndvi_max: v.ndviMax,
      ndmi_median: v.ndmiMedian,
      ndvi_slope_yr: v.ndviSlope,
      ndmi_slope_yr: v.ndmiSlope,
      ndmi_reliable: v.ndmiReliable,
      n_observations: u.ndvi.length,
      reason_ar: v.reasonAr,
      // Actionable means a crew can be sent. A sand pitch reading low is a
      // true measurement and a false errand.
      actionable: priority > 0 && expectsVegetation,
      priority,
      action_ar: ACTION_AR[v.status] ?? null,
    });
  }

  await bulkUpsert({
    table: 'green_health',
    columns: ['green_unit_id', 'assessed_on', 'status', 'ndvi_median', 'ndvi_max', 'ndmi_median', 'ndvi_slope_yr',
      'ndmi_slope_yr', 'ndmi_reliable', 'n_observations', 'reason_ar',
      'actionable', 'priority', 'action_ar'],
    rows: out,
    conflictTarget: ['green_unit_id', 'assessed_on'],
  });

  const tally = out.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(18)} ${n}`);
  }
  const work = out.filter((r) => r.actionable).sort((a, b) => b.priority - a.priority);
  console.log(`  ${work.length} actionable of ${out.length} — top of the queue:`);
  for (const r of work.slice(0, 5)) {
    console.log(`    ${String(r.priority).padStart(5)}  ${r.status.padEnd(13)} ${r.green_unit_id}`);
  }
  return { assets: out.length, tally, actionable: work.length };
}
