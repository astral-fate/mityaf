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
    // 'force-cache' pinned these files in the browser across deploys: after a
    // pipeline run shipped 696 assets, a returning visitor kept being served
    // the 324-asset file and the dashboard told them health had never been
    // run. 'no-cache' revalidates instead — the ETag makes that a 304 when
    // nothing changed, and the in-memory Map above already stops repeat
    // fetches within a session, which is what the original setting was for.
    const res = await fetch(`/data/${name}`, { signal, cache: 'no-cache' });
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
/** The same rows without geometry: the list page draws a table, not a map. */
export const loadSegmentList = () => loadJson('segments-list.json');

/**
 * Which shard holds a segment. MUST match shard_key() in
 * research/derive_segment_labels.py -- a plain code-unit sum, mod 64, because
 * the only requirement is that Python and JS agree and the ids are ASCII.
 */
export function segmentShard(id, shards = 64) {
  let n = 0;
  for (let i = 0; i < id.length; i += 1) n += id.charCodeAt(i);
  return n % shards;
}

/**
 * One segment, without its 30,336 neighbours.
 *
 * The detail view used to load segments.geojson (9.1 MB) to find a single
 * feature, then fall back to ponding-segments.json (13 MB) whenever the id was
 * not on the 2,617-row shortlist -- true for 27,720 of 30,337 segments. Cold,
 * that page moved 11.95 MB to draw one street. A shard is ~149 KB.
 */
export async function loadSegmentById(id, opts) {
  const shard = String(segmentShard(id)).padStart(2, '0');
  const data = await loadJson(`seg/${shard}.json`, opts);
  const feature = (data?.features ?? []).find((f) => f.properties?.id === id) ?? null;
  return { feature, roadNames: data?.roadNames ?? [] };
}
export const loadGreen = () => loadJson('green.geojson');
export const loadTopSegments = () => loadJson('segments-top.json');
export const loadWasteEvents = () => loadJson('waste-events.json');
export const loadRain = () => loadJson('rain.json');
export const loadDistricts = () => loadJson('districts.geojson');
export const loadHealth = () => loadJson('green-health.json');
export const loadSocial = () => loadJson('social.json');
/** One asset's full index history. Split per asset so a detail page does not
 *  pull every reading in the city to draw one chart. */
export const loadGreenDetail = (id) => loadJson(`green/${id}.json`);

// ponding-segments.json is 13 MB and has no consumer: the segment detail page
// used to fetch it for one record, and that record now rides in the shard.
// The loader is deliberately not exported -- reinstating it would quietly
// restore a 13 MB download to a page that needs 339 KB.
export const loadPondingShortlist = () => loadJson('ponding-shortlist.json');
export const loadTunnels = () => loadJson('ponding-tunnels.json');
export const loadPondingDistricts = () => loadJson('ponding-districts.geojson');
export const loadIncidents = () => loadJson('ponding-incidents.json');
export const loadPondingRain = () => loadJson('ponding-rain.json');
export const loadBasin = () => loadJson('ponding-basin.json');

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
