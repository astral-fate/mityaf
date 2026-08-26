/**
 * Sentinel-2 backfill.
 *
 * Iterates PER SCENE DATE, not per unit. The prior pipeline looped one
 * reduceRegion per site, which for ~650 units over 12 months would have been
 * thousands of blocking round-trips. Here each date costs roughly one call per
 * chunk of 200 polygons, so the whole backfill is a few hundred calls.
 *
 * Every observation is joined to the rain context on write, because the
 * rainless gate is what decides whether a wet reading means waste or ponding.
 */
import { bulkUpsert, query } from './db.js';
import { config } from './config.js';
import * as gee from './gee.js';

/** Rain context for a date, from the already-ingested archive. */
async function rainIndex() {
  const { rows } = await query(
    'SELECT date, rain_72h_mm, days_since_rain FROM weather_daily');
  const map = new Map();
  for (const r of rows) {
    map.set(new Date(r.date).toISOString().slice(0, 10), r);
  }
  return map;
}

export async function backfillS2({ run = null, months = 12, unitTypes = ['green', 'ring'] } = {}) {
  const { rows: unitRows } = await query(
    `SELECT unit_id AS "unitId", ST_AsGeoJSON(geom) AS gj
       FROM units WHERE unit_type = ANY($1) AND active`,
    [unitTypes]);
  const units = unitRows.map((u) => ({ unitId: u.unitId, geometry: JSON.parse(u.gj) }));

  if (!units.length) {
    console.log('  no units — run build-units first');
    return { observations: 0 };
  }

  const end = new Date();
  const start = new Date(end.getTime() - months * 30 * 864e5);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  console.log(`  units   : ${units.length.toLocaleString()} (${unitTypes.join(', ')})`);
  console.log(`  window  : ${startStr} -> ${endStr}`);

  const dates = await gee.sceneDates(startStr, endStr);
  console.log(`  scenes  : ${dates.length} distinct Sentinel-2 dates`);

  const rain = await rainIndex();
  const chunks = gee.chunkUnits(units);
  let written = 0;
  let calls = 0;
  let failed = 0;

  for (const [i, date] of dates.entries()) {
    const docs = [];

    for (const chunk of chunks) {
      try {
        const rows = await gee.reduceUnitsForDate(chunk, date);
        calls++;
        const ctx = rain.get(date) ?? {};
        const obsTs = new Date(`${date}T00:00:00Z`);

        for (const r of rows) {
          docs.push({
            unitId: r.unitId,
            obsTs,
            obsDate: date,
            sensor: 'S2',
            ndvi: r.ndvi, ndwi: r.ndwi, savi: r.savi,
            mndwi: r.mndwi, ndmi: r.ndmi, ndbi: r.ndbi,
            wetPixelFrac: r.wetFrac,
            // honesty: MNDWI/NDMI/NDBI come from B11/B8A, native 20 m — not 10 m
            opticalNativeScaleM: 20,
            qualityFlag: 'ok',
            rain72hMm: ctx?.rain_72h_mm ?? null,
            daysSinceRain: ctx?.days_since_rain ?? null,
            ingestedAt: new Date(),
          });
        }
      } catch (err) {
        failed++;
        console.log(`    [${date}] chunk failed: ${String(err.message).slice(0, 90)}`);
      }
    }

    if (docs.length) {
      written += await bulkUpsert({
        table: 'observations',
        columns: ['unit_id', 'obs_ts', 'obs_date', 'sensor', 'ndvi', 'ndwi', 'savi',
                  'mndwi', 'ndmi', 'ndbi', 'wet_pixel_frac', 'optical_native_scale_m',
                  'quality_flag', 'rain_72h_mm', 'days_since_rain'],
        rows: docs.map((o) => ({
          unit_id: o.unitId, obs_ts: o.obsTs, obs_date: o.obsDate, sensor: o.sensor,
          ndvi: o.ndvi, ndwi: o.ndwi, savi: o.savi,
          mndwi: o.mndwi, ndmi: o.ndmi, ndbi: o.ndbi,
          wet_pixel_frac: o.wetPixelFrac,
          optical_native_scale_m: o.opticalNativeScaleM,
          quality_flag: o.qualityFlag,
          rain_72h_mm: o.rain72hMm, days_since_rain: o.daysSinceRain,
        })),
        conflictTarget: ['unit_id', 'sensor', 'obs_ts'],
      });
    }

    if ((i + 1) % 5 === 0 || i === dates.length - 1) {
      console.log(`    ${i + 1}/${dates.length} dates  ${written.toLocaleString()} observations`);
    }
  }

  run?.add({ rowsWritten: written, geeCalls: calls, errors: failed });
  console.log(`  written : ${written.toLocaleString()} observations, ${calls} EE calls`);
  return { observations: written, calls, failed };
}
