/**
 * Read a file the municipality already has and turn it into a map layer.
 *
 * The gap this closes is specific: we model drainage from terrain because the
 * Amanah's own network is not published as geometry. Anyone holding that
 * geometry can drop it here and see it against our ranking immediately, with
 * no import ticket and nothing uploaded anywhere — every format below is
 * parsed in the browser, so the file never leaves the machine.
 *
 * The rule that matters is that a layer is either placed correctly or refused.
 * A GeoTIFF in an unknown projection would land hundreds of metres off and
 * look plausible while doing it, so we read the projection and say no rather
 * than guess.
 */

const MAX_RASTER_PX = 2048;      // downsample target; a full ortho is far bigger
const MAX_VECTOR_BYTES = 60 * 1024 * 1024;

export class ImportError extends Error {}

/* ── projection ──────────────────────────────────────────────────────────── */

const MERC_R = 20037508.342789244;

function mercToLngLat([x, y]) {
  const lon = (x / MERC_R) * 180;
  const lat = (Math.atan(Math.exp((y / MERC_R) * Math.PI)) * 360) / Math.PI - 90;
  return [lon, lat];
}

/** 4326 passes through; 3857 converts; anything else is refused, not guessed. */
function bboxToWgs84(bbox, geoKeys) {
  const geographic = geoKeys?.GeographicTypeGeoKey;
  const projected = geoKeys?.ProjectedCSTypeGeoKey;

  if (projected === 3857 || projected === 900913 || projected === 102100) {
    const [w, s] = mercToLngLat([bbox[0], bbox[1]]);
    const [e, n] = mercToLngLat([bbox[2], bbox[3]]);
    return [w, s, e, n];
  }
  if (!projected && (geographic === 4326 || geographic === undefined)) {
    // Degrees, or a file with no CRS at all whose values are already lon/lat.
    const plausible =
      Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180 &&
      Math.abs(bbox[1]) <= 90 && Math.abs(bbox[3]) <= 90;
    if (plausible) return bbox;
    throw new ImportError(
      'الملف لا يحمل نظام إحداثيات، وقيمه ليست درجات جغرافية — لا نستطيع تحديد موقعه على الخريطة. '
      + 'أعِد تصديره بنظام WGS 84 (EPSG:4326).',
    );
  }
  throw new ImportError(
    `نظام الإحداثيات في الملف (EPSG:${projected ?? geographic ?? 'غير معروف'}) غير مدعوم. `
    + 'المدعوم: WGS 84 ‏(EPSG:4326) و Web Mercator ‏(EPSG:3857). '
    + 'وضعُ الطبقة في نظام غير مدعوم يزيحها مئات الأمتار دون أن يبدو ذلك خطأً — فنرفضه بدل تخمينه.',
  );
}

/* ── GeoJSON ─────────────────────────────────────────────────────────────── */

function normaliseGeoJson(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new ImportError('الملف ليس GeoJSON صالحاً.');
  if (parsed.type === 'FeatureCollection') {
    if (!Array.isArray(parsed.features)) throw new ImportError('FeatureCollection بلا مصفوفة features.');
    return parsed;
  }
  if (parsed.type === 'Feature') return { type: 'FeatureCollection', features: [parsed] };
  if (parsed.type && parsed.coordinates) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: parsed }] };
  }
  throw new ImportError('لم نتعرّف على بنية GeoJSON في الملف.');
}

/* ── KML ─────────────────────────────────────────────────────────────────── */

/** "lon,lat,alt lon,lat" → [[lon, lat], …]; altitude is dropped. */
function kmlCoords(text) {
  return (text || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',').map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]]);
}

function kmlToGeoJson(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new ImportError('تعذّرت قراءة ملف KML — قد يكون تالفاً.');

  const features = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim() || null;
    const props = { name };
    for (const d of pm.getElementsByTagName('SimpleData')) {
      const k = d.getAttribute('name');
      if (k) props[k] = d.textContent;
    }

    const push = (geometry) => geometry && features.push({ type: 'Feature', properties: props, geometry });

    for (const el of pm.getElementsByTagName('Point')) {
      const c = kmlCoords(el.getElementsByTagName('coordinates')[0]?.textContent);
      if (c.length) push({ type: 'Point', coordinates: c[0] });
    }
    for (const el of pm.getElementsByTagName('LineString')) {
      const c = kmlCoords(el.getElementsByTagName('coordinates')[0]?.textContent);
      if (c.length > 1) push({ type: 'LineString', coordinates: c });
    }
    for (const el of pm.getElementsByTagName('Polygon')) {
      const rings = [];
      for (const tag of ['outerBoundaryIs', 'innerBoundaryIs']) {
        for (const b of el.getElementsByTagName(tag)) {
          const c = kmlCoords(b.getElementsByTagName('coordinates')[0]?.textContent);
          if (c.length > 2) {
            // GeoJSON requires an explicitly closed ring; KML often omits it.
            const first = c[0];
            const last = c[c.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) c.push(first);
            rings.push(c);
          }
        }
      }
      if (rings.length) push({ type: 'Polygon', coordinates: rings });
    }
  }

  if (!features.length) throw new ImportError('لم يحتوِ ملف KML على أي معالم قابلة للرسم.');
  return { type: 'FeatureCollection', features };
}

/* ── GeoTIFF ─────────────────────────────────────────────────────────────── */

/** Percentile stretch: a single-band raster is usually 16-bit and would render
 *  almost black under a naive 0–255 mapping. */
function stretch(band) {
  const sample = [];
  const step = Math.max(1, Math.floor(band.length / 20000));
  for (let i = 0; i < band.length; i += step) {
    const v = band[i];
    if (Number.isFinite(v)) sample.push(v);
  }
  if (!sample.length) return [0, 1];
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.02)];
  const hi = sample[Math.floor(sample.length * 0.98)];
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

async function readGeoTiff(file) {
  let mod;
  try {
    mod = await import('geotiff');
  } catch {
    throw new ImportError('مكتبة قراءة GeoTIFF غير متاحة في هذه النسخة.');
  }

  const tiff = await mod.fromBlob(file);
  const image = await tiff.getImage();
  const bbox = bboxToWgs84(image.getBoundingBox(), image.getGeoKeys());

  const fullW = image.getWidth();
  const fullH = image.getHeight();
  const scale = Math.min(1, MAX_RASTER_PX / Math.max(fullW, fullH));
  const w = Math.max(1, Math.round(fullW * scale));
  const h = Math.max(1, Math.round(fullH * scale));

  // Decoding at full size would hold a multi-hundred-megabyte array; geotiff
  // resamples during read, so we never materialise it.
  const bands = await image.readRasters({ width: w, height: h, interleave: false });
  const n = bands.length;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const img = canvas.getContext('2d').createImageData(w, h);

  if (n >= 3) {
    for (let i = 0; i < w * h; i += 1) {
      img.data[i * 4] = bands[0][i];
      img.data[i * 4 + 1] = bands[1][i];
      img.data[i * 4 + 2] = bands[2][i];
      img.data[i * 4 + 3] = n >= 4 ? bands[3][i] : 255;
    }
  } else {
    const [lo, hi] = stretch(bands[0]);
    for (let i = 0; i < w * h; i += 1) {
      const v = Math.max(0, Math.min(255, ((bands[0][i] - lo) / (hi - lo)) * 255));
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
  }
  canvas.getContext('2d').putImageData(img, 0, 0);

  return {
    kind: 'raster',
    url: canvas.toDataURL('image/png'),
    // MapLibre wants the corners clockwise from top-left.
    coordinates: [
      [bbox[0], bbox[3]], [bbox[2], bbox[3]],
      [bbox[2], bbox[1]], [bbox[0], bbox[1]],
    ],
    bbox,
    detail: `${fullW}×${fullH} بكسل · ${n} نطاق`,
  };
}

/** Extent of any GeoJSON, so the map can fly to a layer the moment it lands.
 *  Walks raw coordinate arrays rather than switching on geometry type — the
 *  nesting differs per type but the leaves are always [lon, lat]. */
function geoJsonBbox(fc) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
      return;
    }
    for (const child of c) walk(child);
  };
  for (const f of fc.features) if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/* ── entry point ─────────────────────────────────────────────────────────── */

const COLORS = ['#2fd8ef', '#f5c15c', '#f08a5a', '#c39a6d', '#a78bfa', '#50ff4a'];
let seq = 0;

/**
 * Parse one dropped file into a layer descriptor.
 * Throws ImportError with an Arabic message the operator can act on.
 */
export async function importFile(file) {
  const name = file.name;
  const ext = name.split('.').pop()?.toLowerCase();

  if (ext === 'kmz') {
    throw new ImportError('ملفات KMZ مضغوطة. فكّ الضغط وأسقِط ملف .kml بداخله.');
  }

  let layer;

  if (ext === 'tif' || ext === 'tiff') {
    layer = await readGeoTiff(file);
  } else if (ext === 'geojson' || ext === 'json' || ext === 'kml') {
    if (file.size > MAX_VECTOR_BYTES) {
      throw new ImportError(`الملف ${Math.round(file.size / 1e6)} ميغابايت — الحد ${MAX_VECTOR_BYTES / 1e6}. قسّمه أو بسّط هندسته.`);
    }
    const text = await file.text();
    const data = ext === 'kml' ? kmlToGeoJson(text) : normaliseGeoJson(JSON.parse(text));
    const kinds = new Set(data.features.map((f) => f.geometry?.type).filter(Boolean));
    layer = {
      kind: 'vector',
      data,
      bbox: geoJsonBbox(data),
      detail: `${data.features.length.toLocaleString('en-US')} معلم · ${[...kinds].join('، ') || '—'}`,
    };
  } else {
    throw new ImportError(`الصيغة «${ext ?? '؟'}» غير مدعومة. المدعوم: GeoJSON و KML و GeoTIFF.`);
  }

  seq += 1;
  return {
    id: `usr_${seq}_${name.replace(/\W+/g, '_').slice(0, 24)}`,
    name,
    sizeMb: file.size / 1e6,
    color: COLORS[(seq - 1) % COLORS.length],
    opacity: 0.85,
    visible: true,
    ...layer,
  };
}
