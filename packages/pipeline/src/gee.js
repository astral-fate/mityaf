/**
 * Google Earth Engine, server-side from Node.
 *
 * The official @google/earthengine npm client authenticates with a service-account
 * key, which is what lets the whole pipeline stay in Node. The API mirrors the
 * Code Editor's JS API but is callback-based, so everything is promisified here.
 *
 * Index note, stated because it matters for honesty: NDVI/NDWI/SAVI come from
 * 10 m bands, but MNDWI/NDMI/NDBI derive from B11/B8A which are 20 m native.
 * Nothing resamples that away — observations record `opticalNativeScaleM`.
 */
import ee from '@google/earthengine';
import { bboxArray, config } from './config.js';

let ready = false;
let lastError = null;

/**
 * Accept the key as raw JSON or base64.
 *
 * Base64 exists because the raw form is easy to corrupt in transit: the
 * private key contains \n escapes, and anything that expands them — a quoted
 * value in a .env file, a dashboard field that reflows long lines — produces
 * a literal newline inside a JSON string, which is not legal JSON. Base64
 * survives all of that.
 */
function parseKey(raw) {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  const json = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  let key;
  try {
    key = JSON.parse(json);
  } catch {
    throw new Error(
      'GEE_SERVICE_ACCOUNT_KEY is not valid JSON or base64. The usual cause is ' +
      'wrapping the raw JSON in quotes in .env — Node expands \\n inside a ' +
      'double-quoted value, which breaks the private key. Leave it unquoted, ' +
      'or use `base64 -w0 key.json`.',
    );
  }
  for (const field of ['client_email', 'private_key']) {
    if (!key[field]) throw new Error(`Service-account key is missing "${field}".`);
  }
  return key;
}

/**
 * Turn an Earth Engine failure into the thing you actually have to go fix.
 * These four are the whole failure surface of a fresh service account, and
 * the raw messages name none of them.
 */
export function explain(err) {
  const m = String(err?.message ?? err);
  if (/invalid_grant|Invalid JWT|invalid signature/i.test(m)) {
    return 'the key was rejected — it may be deleted, disabled, or from another project';
  }
  if (/not been used in project|is disabled|SERVICE_DISABLED|earthengine\.googleapis\.com/i.test(m)) {
    return 'the Earth Engine API is not enabled on this project (step 2 in .env.example)';
  }
  if (/serviceusage\.services\.use|Service Usage Consumer|caller does not have permission/i.test(m)) {
    return 'the service account is missing Service Usage Consumer (step 4)';
  }
  if (/not registered|register.*Earth Engine|EE_NOT_REGISTERED/i.test(m)) {
    return 'the Cloud project is not registered for Earth Engine (step 1)';
  }
  if (/permission|forbidden|403/i.test(m)) {
    return 'permission denied — most likely Resource Viewer was granted instead of ' +
      'Resource Writer, which authenticates fine but cannot run computations';
  }
  return null;
}

export const isReady = () => ready;
export const initError = () => lastError;

/** Authenticate + initialise. Never throws into a caller's hot path. */
export async function init() {
  if (ready) return true;

  const raw = config.geeServiceAccountKey;
  if (!raw) {
    lastError =
      'GEE_SERVICE_ACCOUNT_KEY is not set. See .env.example for the five console ' +
      'steps; the short version is that the Cloud project must be registered for ' +
      'Earth Engine and the service account needs Resource Writer plus Service ' +
      'Usage Consumer.';
    throw new Error(lastError);
  }

  const key = parseKey(raw);

  await new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      key,
      () => ee.initialize(null, null, resolve, reject, null, config.geeProject),
      (err) => reject(new Error(`GEE auth failed: ${err}`)),
    );
  });

  ready = true;
  lastError = null;
  console.log(`  [gee] initialised on project '${config.geeProject}'`);
  return true;
}

/** Promisified evaluate — the only way results leave the EE server. */
export function evaluate(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.evaluate((result, err) => (err ? reject(new Error(err)) : resolve(result)));
  });
}

export const aoiGeometry = () => ee.Geometry.Rectangle(bboxArray());

// ── masking ────────────────────────────────────────────────────────────────
/**
 * Scene-level CLOUDY_PIXEL_PERCENTAGE is not enough: it lets cloud shadow fall
 * across an individual park while the scene as a whole looks clear. Mask per
 * pixel with the Scene Classification Layer.
 *
 * SCL classes dropped: 1 saturated, 3 cloud shadow, 8 cloud medium prob,
 * 9 cloud high prob, 10 cirrus, 11 snow.
 */
export function maskS2(image) {
  const scl = image.select('SCL');
  const bad = scl.eq(1).or(scl.eq(3)).or(scl.eq(8)).or(scl.eq(9)).or(scl.eq(10)).or(scl.eq(11));
  return image.updateMask(bad.not());
}

// ── indices ────────────────────────────────────────────────────────────────
export function addIndices(image) {
  const ndvi = image.normalizedDifference(['B8', 'B4']).rename('ndvi');
  const ndwi = image.normalizedDifference(['B3', 'B8']).rename('ndwi');   // McFeeters: open water
  const mndwi = image.normalizedDifference(['B3', 'B11']).rename('mndwi'); // better in urban
  const ndmi = image.normalizedDifference(['B8A', 'B11']).rename('ndmi');  // canopy moisture
  const ndbi = image.normalizedDifference(['B11', 'B8']).rename('ndbi');   // built-up proxy
  const savi = image
    .expression('1.5 * (NIR - RED) / (NIR + RED + 0.5)', {
      NIR: image.select('B8'),
      RED: image.select('B4'),
    })
    .rename('savi');

  // fraction of the unit reading as open water, using MNDWI which separates
  // water from built surfaces far better than NDWI in a city
  const wet = mndwi.gt(-0.1).rename('wetFrac');

  return image
    .addBands([ndvi, ndwi, mndwi, ndmi, ndbi, savi, wet])
    .copyProperties(image, ['system:time_start', 'CLOUDY_PIXEL_PERCENTAGE', 'system:index']);
}

export function s2Collection(start, end) {
  return ee
    .ImageCollection(config.collections.s2)
    .filterBounds(aoiGeometry())
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60)) // cheap pre-filter; SCL does the real work
    .map(maskS2)
    .map(addIndices);
}

/** Distinct acquisition dates available in a window — used to iterate per scene. */
export async function sceneDates(start, end) {
  const col = s2Collection(start, end);
  const dates = col.aggregate_array('system:time_start');
  const millis = await evaluate(dates);
  const uniq = [...new Set(millis.map((m) => new Date(m).toISOString().slice(0, 10)))];
  return uniq.sort();
}

// ── zonal statistics ───────────────────────────────────────────────────────
const INDEX_BANDS = ['ndvi', 'ndwi', 'mndwi', 'ndmi', 'ndbi', 'savi', 'wetFrac'];

/**
 * Mean of every index over many polygons, for ONE date.
 *
 * This is the fix for the prior pipeline's bottleneck: it looped one
 * reduceRegion per site, so 500 units x 12 months would have been ~6,000
 * blocking round-trips. reduceRegions does many polygons in one call, and we
 * iterate per scene date instead of per unit — roughly 2 calls per date.
 */
export async function reduceUnitsForDate(units, dateStr, { scale = 20 } = {}) {
  const start = ee.Date(dateStr);
  const end = start.advance(1, 'day');

  const image = s2Collection(start, end).mosaic();

  const features = units.map((u) =>
    ee.Feature(ee.Geometry(u.geometry), { unitId: u.unitId }),
  );
  const fc = ee.FeatureCollection(features);

  const reduced = image
    .select(INDEX_BANDS)
    .reduceRegions({
      collection: fc,
      reducer: ee.Reducer.mean(),
      scale,
      tileScale: 4, // trade speed for memory; avoids "computed value too large"
    })
    .select(['unitId', ...INDEX_BANDS], null, false);

  const raw = await evaluate(reduced);
  return (raw?.features ?? [])
    .map((f) => f.properties)
    .filter((p) => p.ndvi !== null && p.ndvi !== undefined);
}

/** Chunk a unit list so no single EE request carries too many polygons. */
export function chunkUnits(units, size = config.geeChunkSize) {
  const out = [];
  for (let i = 0; i < units.length; i += size) out.push(units.slice(i, i + size));
  return out;
}

// ── Sentinel-1 ─────────────────────────────────────────────────────────────
/**
 * Orbit matching is non-negotiable. Backscatter depends on incidence angle and
 * look direction, so a VV value from track 6 is not comparable to one from
 * track 109. Every comparison happens within one relative orbit and one pass.
 */
export function s1Collection({ relativeOrbit = null, pass = null } = {}) {
  let col = ee
    .ImageCollection(config.collections.s1)
    .filterBounds(aoiGeometry())
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.eq('resolution_meters', 10));

  if (pass) col = col.filter(ee.Filter.eq('orbitProperties_pass', pass));
  if (relativeOrbit !== null) {
    col = col.filter(ee.Filter.eq('relativeOrbitNumber_start', relativeOrbit));
  }
  return col;
}

/** Which S1 tracks actually cover Madinah, and how densely. Run this first. */
export async function s1TrackHistogram() {
  const hist = s1Collection().aggregate_histogram('relativeOrbitNumber_start');
  return evaluate(hist);
}

/** Latest S1 acquisition — verifies whether the archive is still being fed. */
export async function s1LatestDate() {
  const max = s1Collection().aggregate_max('system:time_start');
  const millis = await evaluate(max);
  return millis ? new Date(millis).toISOString().slice(0, 10) : null;
}

export async function s2LatestDate() {
  const max = ee
    .ImageCollection(config.collections.s2)
    .filterBounds(aoiGeometry())
    .aggregate_max('system:time_start');
  const millis = await evaluate(max);
  return millis ? new Date(millis).toISOString().slice(0, 10) : null;
}

/**
 * Speckle filtering must happen in LINEAR power, never in dB — averaging
 * decibels averages logarithms and biases the result low.
 */
export function speckleFilter(image, band = 'VV', radiusM = 30) {
  const linear = ee.Image(10).pow(image.select(band).divide(10));
  const smoothed = linear.focal_mean(radiusM, 'circle', 'meters');
  return smoothed.log10().multiply(10).rename(band);
}

export { ee };
