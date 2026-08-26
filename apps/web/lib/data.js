/**
 * Data access for the dashboard.
 *
 * Everything is fetched from /data/*.json, which Vercel serves as static edge
 * assets. That is deliberate: the pipeline is batch (satellite revisit is 5
 * days), so precomputing and serving from the CDN is both simpler and faster
 * than a live API — and it keeps Earth Engine credentials off the web host.
 *
 * Every call degrades to null rather than throwing, so a missing file shows an
 * empty state instead of a white screen.
 */

const cache = new Map();

export async function loadJson(name, { signal } = {}) {
  if (cache.has(name)) return cache.get(name);
  try {
    const res = await fetch(`/data/${name}`, { signal, cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache.set(name, json);
    return json;
  } catch {
    return null;
  }
}

export const loadMeta = () => loadJson('meta.json');
export const loadSegments = () => loadJson('segments.geojson');
export const loadGreen = () => loadJson('green.geojson');
export const loadTopSegments = () => loadJson('segments-top.json');
export const loadWasteEvents = () => loadJson('waste-events.json');
export const loadRain = () => loadJson('rain.json');

/** Colour ramp shared by the map paint expression and the list rows. */
export function riskColor(score) {
  if (score === null || score === undefined) return '#6B7A9E';
  if (score >= 75) return '#FF6B5A';
  if (score >= 55) return '#FFC857';
  if (score >= 35) return '#50FF4A';
  return '#2A9759';
}

export function riskLabelAr(band) {
  return {
    critical: 'حرج',
    high: 'مرتفع',
    moderate: 'متوسط',
    stable: 'مستقر',
    insufficient_data: 'بيانات غير كافية',
  }[band] ?? 'غير مصنّف';
}

/** Latin digits, grouped — never ar-SA, which emits Eastern Arabic numerals. */
export const fmt = (n, dp = 0) =>
  n === null || n === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      }).format(n);
