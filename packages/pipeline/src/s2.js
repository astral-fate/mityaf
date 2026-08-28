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

/** Matches MIN_OBS_TREND in health.js: below this a unit cannot carry a trend,
 *  so it is what "already covered" has to mean. */
const MIN_COVERAGE = 20;

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

export async function backfillS2({
  run = null, months = 12, unitTypes = ['green', 'ring'], onlyMissing = false,
} = {}) {
  // Earth Engine throttles concurrent requests from one service account, so
  // wall clock tracks total units x dates almost linearly. That makes skipping
  // units that are already covered the only lever that actually shortens a
  // backfill: after the inventory grew from 324 to 696 assets, re-reading the
  // 324 that were already complete was three quarters of the work.
  const { rows: unitRows } = await query(
    onlyMissing
      // "Has any observation" is the wrong test: a partial run leaves every unit
      // with a few dates, which would then exclude all of them. What matters is
      // whether a unit has enough readings to carry a verdict.
      ? `SELECT u.unit_id AS "unitId", ST_AsGeoJSON(u.geom) AS gj
           FROM units u
           LEFT JOIN observations o
             ON o.unit_id = u.unit_id AND o.sensor = 'S2'
            AND o.obs_date >= (CURRENT_DATE - ($2 || ' days')::interval)
          WHERE u.unit_type = ANY($1) AND u.active
          GROUP BY u.unit_id, u.geom
         HAVING count(o.unit_id) < $3`
      : `SELECT unit_id AS "unitId", ST_AsGeoJSON(geom) AS gj
           FROM units WHERE unit_type = ANY($1) AND active`,
    onlyMissing
      ? [unitTypes, String(Math.round(months * 30)), MIN_COVERAGE]
      : [unitTypes]);
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

    // Earth Engine is a remote service, so each chunk spends almost all of its
    // time waiting rather than computing. Running them serially made the wall
    // clock the sum of every round trip: at 1,392 units that is seven calls a
    // date and roughly two minutes a date, which put a full backfill near five
    // hours. Issuing them together turns that sum into its maximum.
    const settled = await Promise.allSettled(
      chunks.map((chunk) => gee.reduceUnitsForDate(chunk, date)));

    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        failed++;
        console.log(`    [${date}] chunk failed: `
          + `${String(outcome.reason?.message ?? outcome.reason).slice(0, 90)}`);
        continue;
      }
      try {
        const rows = outcome.value;
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
        // Transport failures are handled by allSettled above; reaching here
        // means a returned row could not be mapped, which is a different bug.
        failed++;
        console.log(`    [${date}] row mapping failed: ${String(err.message).slice(0, 90)}`);
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
