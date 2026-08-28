/**
 * Susceptibility bands for street segments.
 *
 * Lives here rather than in the page because two routes need it, and importing
 * a constant from a page module makes Next hoist that page into a shared chunk
 * for no benefit.
 *
 * The bands are PERCENTILE cuts within Madinah, not probability thresholds.
 * The model was trained on New York and Chicago, so its ordering transfers to
 * an unseen city while its absolute calibration does not — the hint strings say
 * so wherever a band is shown.
 */
export const BANDS = {
  critical: { ar: 'حرج', color: '#e8596b', hint: 'أعلى ٥٪ من مقاطع المدينة' },
  high: { ar: 'مرتفع', color: '#f08a5a', hint: 'أعلى ٢٠٪' },
  moderate: { ar: 'متوسط', color: '#f5c15c', hint: 'النصف الأعلى' },
  stable: { ar: 'مستقر', color: '#50ff4a', hint: 'النصف الأدنى' },
  insufficient_data: { ar: 'غير مُقيَّم', color: '#66739a', hint: 'لا تضاريس محسوبة' },
};

export const BAND_ORDER = ['critical', 'high', 'moderate', 'stable', 'insufficient_data'];
