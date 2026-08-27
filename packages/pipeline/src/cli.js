#!/usr/bin/env node
/**
 * Mityaf pipeline CLI.
 *
 *   node src/cli.js <command>
 *
 * Commands:
 *   doctor            check env, Postgres/PostGIS, Earth Engine, S1 archive gap
 *   build-units       OSM -> green assets, spill rings, street segments
 *   build-districts   OSM district centres -> Voronoi cells -> stamp every unit
 *   backfill-weather  Open-Meteo daily archive -> rain events
 *   backfill-s2       Sentinel-2 index time series over every unit
 *   export-static     write precomputed JSON into apps/web/public/data
 *   all               units -> weather -> s2 -> export
 */
import { close, initSchema, ping, query, withRun } from './db.js';
import { config } from './config.js';
import * as gee from './gee.js';
import * as units from './units.js';
import { buildDistricts } from './districts.js';
import * as weather from './weather.js';
import { exportStatic } from './export.js';
import { backfillS2 } from './s2.js';

const cmd = process.argv[2] ?? 'help';

// ── doctor ─────────────────────────────────────────────────────────────────
async function doctor() {
  const masked = (config.databaseUrl ?? '(unset)').replace(/\/\/[^@]*@/, '//***@');
  console.log('postgres:', masked);
  try {
    await initSchema();
    const v = await ping();
    console.log('          ', v.v.split(',')[0]);
    console.log('           PostGIS', v.postgis.split(' ')[0]);
    const { rows } = await query(
      `SELECT unit_type, count(*)::int AS n FROM units GROUP BY unit_type ORDER BY n DESC`);
    console.log('           units:',
      rows.length ? rows.map((r) => `${r.unit_type}=${r.n}`).join(' ') : '(empty)');
  } catch (err) {
    console.log('           FAILED:', String(err.message ?? err).slice(0, 160));
  }

  console.log('gee     : project', config.geeProject);
  if (!config.geeServiceAccountKey) {
    console.log('          no GEE_SERVICE_ACCOUNT_KEY — satellite steps will not run');
    return;
  }
  try {
    await gee.init();
    const [s2Latest, s1Latest, tracks] = await Promise.all([
      gee.s2LatestDate(),
      gee.s1LatestDate(),
      gee.s1TrackHistogram(),
    ]);
    console.log(`          Sentinel-2 latest over AOI : ${s2Latest}`);
    console.log(`          Sentinel-1 latest over AOI : ${s1Latest}`);

    // This check exists because the GEE catalogue lists S1_GRD ending in
    // Oct 2025 while S2 is current. If that gap is real, live radar
    // verification is unavailable and only the historical archive works.
    if (s1Latest && s2Latest) {
      const gapDays = Math.round((new Date(s2Latest) - new Date(s1Latest)) / 864e5);
      if (gapDays > 45) {
        console.log(`          WARNING: S1 archive is ${gapDays} days behind S2.`);
        console.log('          Historical ponding + before/after still work;');
        console.log('          live radar verification does not. Say so, do not imply it.');
      }
    }
    const sorted = Object.entries(tracks ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    console.log('          S1 tracks over AOI (orbit=scenes):',
      sorted.map(([k, v]) => `${k}=${v}`).join(' ') || '(none)');
  } catch (err) {
    console.log('          FAILED:', String(err).slice(0, 200));
    const why = gee.explain(err);
    if (why) console.log('          likely cause:', why);
  }
}

// ── main ───────────────────────────────────────────────────────────────────
const commands = {
  doctor,

  'build-districts': () =>
    withRun('build_districts', { aoi: config.aoi }, async (run) => {
      await initSchema();
      const r = await buildDistricts({ refresh: process.argv.includes('--refresh') });
      run.add({ districts: r.districts, unitsStamped: r.assigned });
    }),

  'build-units': () =>
    withRun('build_units', { aoi: config.aoi }, async () => {
      await initSchema();
      await units.buildAll();
    }),

  'backfill-weather': () =>
    withRun('backfill_weather', { start: '2015-01-01' }, async (run) => {
      await initSchema();
      const r = await weather.backfill({});
      run.add({ rowsWritten: r.days, events: r.events });
    }),

  'backfill-s2': () =>
    withRun('backfill_s2', {}, async (run) => {
      await gee.init();
      const r = await backfillS2({ run });
      return r;
    }),

  'export-static': () => withRun('export_static', {}, () => exportStatic()),

  all: async () => {
    await commands['build-units']();
    await commands['backfill-weather']();
    if (config.geeServiceAccountKey) await commands['backfill-s2']();
    else console.log('\n[skip] backfill-s2 — GEE_SERVICE_ACCOUNT_KEY not set');
    await commands['export-static']();
  },

  help: () => {
    console.log(
      `Mityaf pipeline\n\n` +
      `  doctor            check env, Postgres/PostGIS, Earth Engine, S1 archive gap\n` +
      `  build-units       OSM -> green assets, spill rings, street segments\n` +
      `  backfill-weather  Open-Meteo archive -> rain events\n` +
      `  backfill-s2       Sentinel-2 index time series over every unit\n` +
      `  export-static     write precomputed JSON for the web app\n` +
      `  all               run the sequence above\n`,
    );
  },
};

const run = commands[cmd] ?? commands.help;

try {
  await run();
} catch (err) {
  console.error(`\n[${cmd}] failed:`, err?.message ?? err);
  process.exitCode = 1;
} finally {
  await close();
}
