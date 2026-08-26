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
import { collections, connect } from './db.js';
import { config } from './config.js';
import * as gee from './gee.js';

/** Rain context for a date, from the already-ingested archive. */
async function rainIndex() {
  const d = await connect();
  const rows = await d
    .collection(collections.weatherDaily)
    .find({})
    .project({ date: 1, rain72hMm: 1, daysSinceRain: 1, precipitationSumMm: 1, _id: 0 })
    .toArray();
  const map = new Map();
  for (const r of rows) {
    map.set(r.date.toISOString().slice(0, 10), r);
  }
  return map;
}

export async function backfillS2({ run = null, months = 12, unitTypes = ['green', 'ring'] } = {}) {
  const d = await connect();

  const units = await d
    .collection(collections.units)
    .find({ unitType: { $in: unitTypes }, active: true })
    .project({ unitId: 1, geometry: 1, _id: 0 })
    .toArray();

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
            rain72hMm: ctx.rain72hMm ?? null,
            daysSinceRain: ctx.daysSinceRain ?? null,
            ingestedAt: new Date(),
          });
        }
      } catch (err) {
        failed++;
        console.log(`    [${date}] chunk failed: ${String(err.message).slice(0, 90)}`);
      }
    }

    if (docs.length) {
      const ops = docs.map((doc) => ({
        updateOne: {
          filter: { unitId: doc.unitId, sensor: doc.sensor, obsTs: doc.obsTs },
          update: { $set: doc },
          upsert: true,
        },
      }));
      for (let j = 0; j < ops.length; j += 1000) {
        await d.collection(collections.observations).bulkWrite(ops.slice(j, j + 1000), {
          ordered: false,
        });
      }
      written += docs.length;
    }

    if ((i + 1) % 5 === 0 || i === dates.length - 1) {
      console.log(`    ${i + 1}/${dates.length} dates  ${written.toLocaleString()} observations`);
    }
  }

  run?.add({ rowsWritten: written, geeCalls: calls, errors: failed });
  console.log(`  written : ${written.toLocaleString()} observations, ${calls} EE calls`);
  return { observations: written, calls, failed };
}
