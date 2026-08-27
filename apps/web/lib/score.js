/**
 * درجة الأداء — a 0-100 score per green asset, and a roll-up per district.
 *
 * Deliberately a transparent weighted sum rather than the K-means tiering used
 * in the palm work. A municipal engineer has to be able to defend a number in
 * a meeting: "this scored 38 because its canopy moisture is low and its trend
 * is falling" is arguable, whereas "the clustering put it in tier 3" is not.
 * Every component below is reported alongside the total for that reason.
 *
 * Components, mirroring the farm-performance features but stated in the terms
 * a parks department already uses:
 *
 *   الحيوية    vigour     — how much canopy there is        (NDVI median)
 *   الرطوبة    moisture   — whether the canopy is watered    (NDMI median)
 *   الاتجاه    trend      — is it improving or slipping      (NDVI slope)
 *   الثقة      confidence — how well we could see it         (observation count)
 *
 * An asset we could barely see does not score well by default; it scores
 * `null`, because a confident-looking number derived from four cloudy looks is
 * worse than no number at all.
 */

export const BANDS = [
  { min: 80, key: 'excellent', ar: 'ممتاز', color: '#50ff4a' },
  { min: 60, key: 'good', ar: 'جيد', color: '#9ae84a' },
  { min: 40, key: 'fair', ar: 'مقبول', color: '#f5c15c' },
  { min: 20, key: 'poor', ar: 'ضعيف', color: '#f08a5a' },
  { min: 0, key: 'critical', ar: 'حرج', color: '#e8596b' },
];

export function band(score) {
  if (score === null || score === undefined) {
    return { key: 'unknown', ar: 'غير مُقيَّم', color: '#66739a' };
  }
  return BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * NDVI in an arid city: 0.15 is bare ground, 0.55 is a well-watered lawn.
 * Anchoring the scale there rather than to NDVI's theoretical 0..1 stops every
 * asset in Madinah scoring in the twenties for reasons of climate.
 */
const vigourOf = (ndvi) => (ndvi === null ? null : clamp01((ndvi - 0.12) / (0.55 - 0.12)));
const moistureOf = (ndmi) => (ndmi === null ? null : clamp01((ndmi + 0.15) / 0.45));

/** A slope of +0.1/yr is a strong recovery, -0.1/yr a strong loss. */
const trendOf = (slope) => (slope === null ? null : clamp01((slope + 0.1) / 0.2));

export function scoreAsset(h) {
  if (!h) return { score: null, parts: null, confidence: 0 };

  const n = h.nObservations ?? 0;
  const confidence = clamp01(n / 12);          // a year of clear looks is full marks
  if (n < 6) return { score: null, parts: null, confidence };

  const vigour = vigourOf(h.ndviMedian ?? null);
  const moisture = h.ndmiReliable ? moistureOf(h.ndmiMedian ?? null) : null;
  const trend = trendOf(h.ndviSlopeYr ?? null);

  // Weights redistribute across whatever is actually available, so an asset
  // whose NDMI is unreliable is not silently penalised for our blind spot.
  const parts = [
    { key: 'vigour', ar: 'الحيوية', v: vigour, w: 0.5 },
    { key: 'moisture', ar: 'الرطوبة', v: moisture, w: 0.25 },
    { key: 'trend', ar: 'الاتجاه', v: trend, w: 0.25 },
  ].filter((p) => p.v !== null);

  if (!parts.length) return { score: null, parts: null, confidence };

  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const raw = parts.reduce((a, p) => a + p.v * p.w, 0) / wsum;

  return {
    score: Math.round(raw * 100),
    parts: parts.map((p) => ({ ...p, pct: Math.round(p.v * 100) })),
    confidence,
  };
}

/**
 * District roll-up.
 *
 * Reports the count of assets that carry no score rather than quietly
 * averaging over the ones that do — a district where we could only assess
 * three of forty assets should not look like a district we understand.
 */
export function scoreDistrict(assets) {
  const scored = assets.map((a) => a.score).filter((s) => s !== null && s !== undefined);
  const counts = assets.reduce((acc, a) => {
    acc[a.status ?? 'unassessed'] = (acc[a.status ?? 'unassessed'] ?? 0) + 1;
    return acc;
  }, {});
  return {
    score: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
    nAssets: assets.length,
    nScored: scored.length,
    counts,
    needsAttention: (counts.dead ?? 0) + (counts.declining ?? 0) + (counts.water_stress ?? 0),
  };
}

/** What to actually do about it — the column a table of indices never has. */
export function actionFor(status) {
  return {
    dead: { ar: 'إعادة زراعة — فقد الغطاء خلال فترة الرصد', urgency: 3 },
    declining: { ar: 'فحص ميداني — الخضرة في اتجاه هابط', urgency: 3 },
    water_stress: { ar: 'مراجعة جدول الريّ — إجهاد مائي قبل ظهوره للعين', urgency: 2 },
    sparse: { ar: 'تقييم الغرس — الغطاء متفرّق', urgency: 1 },
    bare: { ar: 'لا إجراء — أرض غير مزروعة أصلاً، تُراجع للتخطيط', urgency: 0 },
    healthy: { ar: 'لا إجراء — الوضع مستقر', urgency: 0 },
    insufficient_data: { ar: 'رصد غير كافٍ — يُعاد التقييم بعد مرورات إضافية', urgency: 0 },
  }[status] ?? { ar: 'لم يُقيَّم بعد', urgency: 0 };
}

export const STATUS_META = {
  healthy: { ar: 'سليم', color: '#50ff4a' },
  water_stress: { ar: 'إجهاد ريّ', color: '#f5c15c' },
  sparse: { ar: 'غطاء متفرّق', color: '#c39a6d' },
  declining: { ar: 'متدهور', color: '#f08a5a' },
  dead: { ar: 'فقد الغطاء', color: '#e8596b' },
  bare: { ar: 'أرض غير مزروعة', color: '#66739a' },
  insufficient_data: { ar: 'رصد غير كافٍ', color: '#66739a' },
};
