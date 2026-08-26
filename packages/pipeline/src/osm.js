/**
 * OpenStreetMap ingestion via Overpass.
 *
 * Two hard-won details are baked in here:
 *  1. Overpass sits behind Apache, which rejects a default library User-Agent
 *     with 406. OSM's usage policy asks for an identifying UA anyway.
 *  2. `way(bbox)` returns WHOLE ways that merely touch the bbox, so a highway
 *     heading for Makkah arrives in full. Callers must clip to the AOI or they
 *     end up ranking streets in other cities.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, overpassBbox } from './config.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const HEADERS = {
  'User-Agent': 'Mityaf/1.0 (urban water monitoring, Al Madinah Municipality)',
  Accept: 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
};

export const ROAD_HALF_WIDTH_M = {
  motorway: 20, motorway_link: 12,
  trunk: 20, trunk_link: 12,
  primary: 12, primary_link: 9,
  secondary: 10, secondary_link: 8,
  tertiary: 8, tertiary_link: 7,
  residential: 6, unclassified: 6,
};

const QUERIES = {
  streets: (bbox) => `
    [out:json][timeout:180];
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]
       ["area"!~"yes"](${bbox});
    out geom;
  `,
  green: (bbox) => `
    [out:json][timeout:180];
    (
      way["leisure"~"^(park|garden|pitch)$"](${bbox});
      way["landuse"~"^(grass|village_green|recreation_ground|forest)$"](${bbox});
    );
    out geom;
  `,
  waterways: (bbox) => `
    [out:json][timeout:180];
    way["waterway"](${bbox});
    out geom;
  `,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(query) {
  let last;
  const attempts = [...ENDPOINTS, ...ENDPOINTS];
  for (let i = 0; i < attempts.length; i++) {
    const url = attempts[i];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(240000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
      const host = new URL(url).host;
      console.log(`  [overpass] ${host} failed: ${String(err).slice(0, 70)} — retrying`);
      await sleep(3000 * (i + 1));
    }
  }
  throw new Error(`all Overpass endpoints failed: ${last}`);
}

const rawDir = () => path.resolve(process.cwd(), 'data/raw');

/** Fetch a layer, caching to disk so the demo is reproducible offline. */
export async function fetchLayer(layer, { refresh = false } = {}) {
  const dir = rawDir();
  await fs.mkdir(dir, { recursive: true });
  const cache = path.join(dir, `osm_${layer}.json`);

  if (!refresh) {
    try {
      const data = JSON.parse(await fs.readFile(cache, 'utf8'));
      console.log(`  [overpass] ${layer}: ${data.elements.length} elements (cached)`);
      return data;
    } catch {
      /* fall through to fetch */
    }
  }

  const data = await post(QUERIES[layer](overpassBbox()));
  await fs.writeFile(cache, JSON.stringify(data), 'utf8');
  console.log(`  [overpass] ${layer}: ${data.elements.length} elements (fetched)`);
  return data;
}

/** Flatten Overpass `out geom` ways into records with a coordinate list. */
export function waysToRecords(data) {
  const out = [];
  for (const el of data.elements ?? []) {
    if (el.type !== 'way' || !el.geometry) continue;
    const coords = el.geometry.map((p) => [p.lon, p.lat]);
    if (coords.length < 2) continue;
    const tags = el.tags ?? {};
    const first = coords[0];
    const last = coords[coords.length - 1];
    out.push({
      osmId: el.id,
      coords,
      tags,
      nameAr: tags['name:ar'] ?? tags.name ?? null,
      nameEn: tags['name:en'] ?? null,
      highway: tags.highway ?? null,
      closed: first[0] === last[0] && first[1] === last[1],
    });
  }
  return out;
}

/** Is a [lon,lat] inside the AOI? */
export function inAoi([lon, lat]) {
  const a = config.aoi;
  return lon >= a.minLon && lon <= a.maxLon && lat >= a.minLat && lat <= a.maxLat;
}
