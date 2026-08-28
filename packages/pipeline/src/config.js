/**
 * Central configuration. Every tunable lives here — no magic numbers buried in
 * the detectors, so a municipal engineer can audit and change a threshold.
 */

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true' || v === '1');

export const config = {
  // ── Postgres (Neon) ──
  // Use the POOLED connection string from Neon for the pipeline: it opens and
  // closes many short-lived connections, which is exactly what the pooler is for.
  databaseUrl: process.env.DATABASE_URL ?? null,
  pgPoolMax: Number(process.env.PG_POOL_MAX ?? 10),

  // ── Earth Engine ──
  // Auth uses a service-account key. The official @google/earthengine npm client
  // supports this server-side, which is what makes an all-Node pipeline possible.
  geeProject: process.env.GEE_PROJECT ?? 'dotted-medley-467420-k3',
  geeServiceAccountKey: process.env.GEE_SERVICE_ACCOUNT_KEY ?? null, // raw JSON string
  geeChunkSize: num(process.env.GEE_CHUNK_SIZE, 200),

  // ── Area of interest: Al Madinah urban envelope, ~22 x 24 km ──
  aoi: {
    minLon: num(process.env.AOI_MIN_LON, 39.5),
    minLat: num(process.env.AOI_MIN_LAT, 24.36),
    maxLon: num(process.env.AOI_MAX_LON, 39.72),
    maxLat: num(process.env.AOI_MAX_LAT, 24.58),
    centerLat: 24.47,
    centerLon: 39.61,
  },

  // ── Earth Engine collections ──
  collections: {
    s2: 'COPERNICUS/S2_SR_HARMONIZED',
    s2CloudProb: 'COPERNICUS/S2_CLOUD_PROBABILITY',
    s1: 'COPERNICUS/S1_GRD',
    dem: 'COPERNICUS/DEM/GLO30',
    worldCover: 'ESA/WorldCover/v200',
    dynamicWorld: 'GOOGLE/DYNAMICWORLD/V1',
  },

  // ── unit geometry ──
  // Turf buffers are geodesic and take metres directly, so there is no CRS
  // transform here at all — which sidesteps the axis-order class of bug entirely.
  units: {
    ringOuterM: num(process.env.RING_OUTER_M, 20),
    ringInnerM: num(process.env.RING_INNER_M, 2),
    segmentLengthM: num(process.env.SEGMENT_LENGTH_M, 200),
    segmentMinLengthM: num(process.env.SEGMENT_MIN_LENGTH_M, 40),
    // A street tree row is a line in OSM. Half a canopy width turns it into a
    // strip with an area; 4 m is a mature date palm's radius in Madinah.
    treeRowHalfWidthM: num(process.env.TREE_ROW_HALF_WIDTH_M, 4),
    greenMinAreaM2: num(process.env.GREEN_MIN_AREA_M2, 200),
    greenMaxAreaM2: num(process.env.GREEN_MAX_AREA_M2, 200000),
    ringTooSmallM2: 1000, // < ~10 Sentinel-2 pixels: cannot support a claim
  },

  // ── the module discriminator ──
  // One satellite time series, two products. Water on impervious surface WITH
  // rain is Module B (ponding). WITHOUT rain it is Module A (irrigation waste).
  rain: {
    rainlessGateMm: num(process.env.RAINLESS_GATE_MM, 1.0),
    rainlessGateDays: num(process.env.RAINLESS_GATE_DAYS, 3),
    eventMinMm: num(process.env.RAIN_EVENT_MIN_MM, 5.0),
  },

  // ── Module A: waste ──
  waste: {
    zThreshold: num(process.env.WASTE_Z_THRESHOLD, 2.0),
    minConsecutivePasses: num(process.env.WASTE_MIN_PASSES, 2),
    baselineWindow: 12, // weekly steps
    baselineMinPeriods: 4,
    baselineSigmaMult: 1.5,
  },

  // ── Module B: ponding (SAR) ──
  // Open water goes DARK. Water between buildings goes BRIGHT: the flat surface
  // plus a vertical wall forms a dihedral corner reflector. A global "dark =
  // water" rule misses exactly the streets that matter, so the sign is chosen by
  // built fraction, never globally.
  sar: {
    openThresholdDb: num(process.env.SAR_OPEN_DB, -3.0),
    urbanThresholdDb: num(process.env.SAR_URBAN_DB, 2.5),
    builtFracSplit: num(process.env.SAR_BUILT_SPLIT, 0.4),
    incidenceMinDeg: 15, // below this: layover
    incidenceMaxDeg: 75, // above this: shadow
  },

  // ── honesty gates ──
  honesty: {
    minObservationCoverage: 0.3, // below this a segment can never be "stable"
    minValidPixelFrac: 0.6,
  },

  // ── alerts ──
  alerts: {
    enabled: bool(process.env.ALERTS_ENABLED, true),
    dryRun: bool(process.env.ALERTS_DRY_RUN, false),
    telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? null,
  },
};

export const bboxArray = () => [
  config.aoi.minLon,
  config.aoi.minLat,
  config.aoi.maxLon,
  config.aoi.maxLat,
];

/** Overpass wants (south,west,north,east). */
export const overpassBbox = () =>
  `${config.aoi.minLat},${config.aoi.minLon},${config.aoi.maxLat},${config.aoi.maxLon}`;

export default config;
