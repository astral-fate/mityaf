/**
 * Pull FABDEM (bare-earth DEM) for a city AOI via Earth Engine.
 *
 * Copernicus GLO-30 is a SURFACE model: it includes buildings and vegetation.
 * Water does not flow over rooftops, so flow accumulation computed on it routes
 * runoff across blocks instead of down the streets between them. Measured over
 * Al Madinah, the surface sits 2.44 m above bare earth across the built-up
 * tenth of the city and 5.44 m across the densest 1% — which is exactly where
 * street flooding happens.
 *
 * FABDEM strips buildings and trees out of GLO-30 with a learned correction
 * (Hawker et al., Bristol/Fathom), cutting mean absolute vertical error in
 * built-up areas from 1.61 m to 1.12 m.
 *
 * It is not published on an open S3 bucket the way Copernicus is — the
 * alternatives are a registration form at Bristol or the Earth Engine
 * community catalogue. We already hold Earth Engine credentials, so we take it
 * from there and write a plain GeoTIFF the Python pipeline can read unchanged.
 *
 * LICENCE: FABDEM is CC BY-NC-SA 4.0 — NON-COMMERCIAL. Fine for research and
 * for this prototype. A paid municipal deployment needs a licence from Fathom,
 * and that decision must be made before this becomes load-bearing.
 *
 *   node research/fetch_fabdem.js madinah
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ee from '@google/earthengine';

import * as gee from '../packages/pipeline/src/gee.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const AOIS = {
  madinah: [39.50, 24.36, 39.72, 24.58],
  nyc: [-74.05, 40.54, -73.70, 40.92],
  chicago: [-87.95, 41.62, -87.50, 42.05],
};

const city = process.argv[2] ?? 'madinah';
const bbox = AOIS[city];
if (!bbox) {
  console.error(`unknown city ${city}; known: ${Object.keys(AOIS).join(', ')}`);
  process.exit(1);
}

await gee.init();

const region = ee.Geometry.Rectangle(bbox);
const fabdem = ee.ImageCollection('projects/sat-io/open-datasets/FABDEM')
  .mosaic()
  .rename('DEM')
  .clip(region);

// 30 m to match the Copernicus grid the rest of the pipeline assumes; any
// other scale would silently change what a "cell" means downstream.
const url = await new Promise((resolve, reject) => {
  fabdem.getDownloadURL(
    { name: `fabdem_${city}`, region, scale: 30, crs: 'EPSG:4326', filePerBand: false, format: 'GEO_TIFF' },
    (u, err) => (err ? reject(new Error(err)) : resolve(u)),
  );
});

console.log(`  requesting FABDEM for ${city} ...`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);

const dir = path.join(HERE, 'cache', city);
await fs.mkdir(dir, { recursive: true });
const dest = path.join(dir, 'FABDEM.tif');
await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));

const kb = Math.round((await fs.stat(dest)).size / 1024);
console.log(`  wrote ${path.relative(process.cwd(), dest)}  ${kb} KB`);
console.log('  licence: FABDEM CC BY-NC-SA 4.0 (non-commercial) — Hawker et al., Bristol/Fathom');
