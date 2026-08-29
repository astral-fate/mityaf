/**
 * NASA POWER — a second, independent rainfall source.
 *
 * Open-Meteo alone is not enough, and this is not a theoretical worry. On
 * 2026-08-26 Open-Meteo reported 0.0 mm at every one of nine points across the
 * AOI; NASA POWER reported 0.18 mm on the same day, and a resident in Madinah
 * reported rain. One reanalysis missing what another catches is the normal case
 * for small convective cells over a 545 km² city, because both products
 * interpolate a grid coarser than the cell.
 *
 * So precipitation is stored per source and reconciled, never overwritten. The
 * incident register has cross-checked ERA5 against POWER since it was built
 * (`era5_peak_mm` beside `power_peak_mm`); this brings the live pipeline to the
 * same standard.
 *
 * Two properties of POWER that shape the code:
 *   latency   PRECTOTCORR publishes a few days behind, and unpublished days come
 *             back as the fill value -999, NOT as null. Treating fill as zero
 *             would silently manufacture dry days at the end of every run.
 *   units     PRECTOTCORR is mm/day, same as Open-Meteo's precipitation_sum, so
 *             the two are directly comparable with no conversion.
 */
import { config } from './config.js';

const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const FILL = -900;          // POWER's no-data sentinel is -999; guard below it

const compact = (d) => d.replaceAll('-', '');

/**
 * Daily precipitation for the AOI centroid, in mm.
 * Returns [{ date, powerMm }] with unpublished days omitted entirely.
 */
export async function fetchPowerDaily({ start, end } = {}) {
  const params = new URLSearchParams({
    parameters: 'PRECTOTCORR',
    community: 'AG',
    longitude: String(config.aoi.centerLon),
    latitude: String(config.aoi.centerLat),
    start: compact(start),
    end: compact(end),
    format: 'JSON',
  });

  const res = await fetch(`${POWER_URL}?${params}`, {
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`NASA POWER HTTP ${res.status}`);
  const json = await res.json();
  const p = json?.properties?.parameter?.PRECTOTCORR;
  if (!p) throw new Error('NASA POWER returned no PRECTOTCORR block');

  const out = [];
  let withheld = 0;
  for (const [k, v] of Object.entries(p).sort()) {
    if (v === null || v <= FILL) { withheld += 1; continue; }
    out.push({
      date: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`,
      powerMm: Number(v),
    });
  }
  if (withheld) {
    console.log(`  [power] ${withheld} day(s) not published yet — omitted, not zeroed`);
  }
  return out;
}

/**
 * Reconcile two sources into the figure the platform should act on.
 *
 * The rule is MAX, not mean. These are detections of a physical event: if one
 * grid caught a cell the other smoothed away, averaging halves a real rainfall
 * toward a threshold it should have crossed. Taking the maximum can overstate,
 * and the disagreement is recorded alongside so the overstatement is visible
 * rather than buried — `sources` names every product that saw anything.
 */
export function reconcile(openMeteoMm, powerMm) {
  const a = Number.isFinite(openMeteoMm) ? openMeteoMm : null;
  const b = Number.isFinite(powerMm) ? powerMm : null;
  if (a === null && b === null) return { mm: null, sources: [], disagreeMm: null };

  const seen = [];
  if (a !== null && a > 0) seen.push('open_meteo');
  if (b !== null && b > 0) seen.push('nasa_power');

  const mm = Math.max(a ?? 0, b ?? 0);
  // Only meaningful where both actually reported; one silent source is a gap,
  // not a disagreement.
  const disagreeMm = (a !== null && b !== null) ? Math.abs(a - b) : null;
  return { mm, sources: seen, disagreeMm };
}
