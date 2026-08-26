/**
 * MongoDB access + schema.
 *
 * Collections mirror the BRD data dictionary. The fields marked "honesty" exist
 * so that reporting a silent zero is structurally impossible: the system is
 * required to distinguish "we observed nothing" from "we could not observe".
 */
import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client = null;
let db = null;

export async function connect() {
  if (db) return db;
  client = new MongoClient(config.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  db = client.db(config.mongoDb);
  return db;
}

export async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export const collections = {
  units: 'units',
  observations: 'observations',
  wasteEvents: 'waste_events',
  weatherDaily: 'weather_daily',
  rainEvents: 'rain_events',
  pondingObservations: 'ponding_observations',
  segmentRisk: 'segment_risk',
  alerts: 'alerts',
  projects: 'projects',
  pipelineRuns: 'pipeline_runs',
};

/**
 * Indexes. 2dsphere is what replaces DuckDB's RTREE + ST_Intersects: it gives us
 * viewport ($geoIntersects) and proximity ($near) queries the map needs.
 */
export async function ensureIndexes() {
  const d = await connect();

  await d.collection(collections.units).createIndexes([
    { key: { unitId: 1 }, unique: true },
    { key: { geometry: '2dsphere' } },
    { key: { unitType: 1, active: 1 } },
    { key: { parentUnitId: 1 } },
    { key: { unitType: 1, 'centroid.coordinates': 1 } },
  ]);

  await d.collection(collections.observations).createIndexes([
    { key: { unitId: 1, sensor: 1, obsTs: 1 }, unique: true },
    { key: { obsDate: -1 } },
    { key: { unitId: 1, obsDate: -1 } },
  ]);

  await d.collection(collections.wasteEvents).createIndexes([
    { key: { eventId: 1 }, unique: true },
    { key: { greenUnitId: 1, detectedOn: -1 } },
    { key: { status: 1, severityScore: -1 } },
    { key: { detectedOn: -1 } },
  ]);

  await d.collection(collections.weatherDaily).createIndexes([
    { key: { date: 1 }, unique: true },
  ]);

  await d.collection(collections.rainEvents).createIndexes([
    { key: { rainEventId: 1 }, unique: true },
    { key: { peakDate: -1 } },
  ]);

  await d.collection(collections.pondingObservations).createIndexes([
    { key: { segmentUnitId: 1, obsTs: 1, sensor: 1 }, unique: true },
    { key: { rainEventId: 1, ponded: 1 } },
    { key: { detectionStatus: 1 } },
  ]);

  await d.collection(collections.segmentRisk).createIndexes([
    { key: { segmentUnitId: 1, modelVersion: 1 }, unique: true },
    { key: { riskScore: -1 } },
    { key: { riskBand: 1, riskScore: -1 } },
  ]);

  await d.collection(collections.alerts).createIndexes([
    { key: { alertId: 1 }, unique: true },
    { key: { dedupeKey: 1 }, unique: true },
    { key: { status: 1, issuedAt: -1 } },
  ]);

  await d.collection(collections.projects).createIndexes([
    { key: { projectId: 1 }, unique: true },
    { key: { geometry: '2dsphere' } },
  ]);

  await d.collection(collections.pipelineRuns).createIndexes([
    { key: { runId: 1 }, unique: true },
    { key: { jobName: 1, startedAt: -1 } },
  ]);
}

/**
 * Append-only job audit. Ported from the prior pipeline's tracking log, with the
 * coverage fields the honesty requirements need.
 */
export class RunLogger {
  constructor(jobName, params = {}) {
    this.jobName = jobName;
    this.params = params;
    this.runId = `${jobName}_${Date.now().toString(36)}`;
    this.startedAt = new Date();
    this.counts = {};
  }

  async start() {
    const d = await connect();
    await d.collection(collections.pipelineRuns).insertOne({
      runId: this.runId,
      jobName: this.jobName,
      params: this.params,
      startedAt: this.startedAt,
      status: 'running',
    });
    return this;
  }

  add(obj) {
    for (const [k, v] of Object.entries(obj)) {
      this.counts[k] = (this.counts[k] ?? 0) + v;
    }
  }

  async finish(error = null) {
    const finishedAt = new Date();
    const durationS = (finishedAt - this.startedAt) / 1000;
    const status = error ? 'failed' : this.counts.errors ? 'partial' : 'ok';
    const d = await connect();
    await d.collection(collections.pipelineRuns).updateOne(
      { runId: this.runId },
      {
        $set: {
          finishedAt,
          durationS,
          status,
          counts: this.counts,
          error: error ? String(error).slice(0, 400) : null,
        },
      },
    );
    const counts = Object.entries(this.counts)
      .map(([k, v]) => `${k}=${v.toLocaleString()}`)
      .join(' ');
    console.log(`[${this.jobName}] ${status} in ${durationS.toFixed(1)}s  ${counts}`);
  }
}

/** Run a job with audit + guaranteed cleanup. */
export async function withRun(jobName, params, fn) {
  const run = await new RunLogger(jobName, params).start();
  try {
    const result = await fn(run);
    await run.finish();
    return result;
  } catch (err) {
    await run.finish(err);
    throw err;
  }
}
