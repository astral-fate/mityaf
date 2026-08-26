/**
 * Postgres + PostGIS access layer (Neon).
 *
 * Neon is serverless Postgres, so connections are cheap to open but the pooler
 * has a connection ceiling — hence a single shared pool rather than a client
 * per call.
 *
 * Metric geometry: every distance, length, area and buffer goes through a
 * `::geography` cast, which is geodesic and takes metres directly. That removes
 * the CRS axis-order class of bug entirely — there is no projection step to get
 * backwards.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { config } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pool = null;

export function getPool() {
  if (pool) return pool;
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Create a Neon project at neon.tech, copy the ' +
      'pooled connection string, and put it in .env as DATABASE_URL.',
    );
  }
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    // Neon terminates plaintext connections; the URL carries sslmode=require
    ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

/** Run a function inside a transaction, rolling back on any throw. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Apply the schema. Idempotent — every statement is IF NOT EXISTS. */
export async function initSchema() {
  const sql = await fs.readFile(path.join(HERE, 'schema.sql'), 'utf8');
  await query(sql);
}

export async function ping() {
  const { rows } = await query('SELECT version() AS v, postgis_version() AS postgis');
  return rows[0];
}

/**
 * Bulk insert via a single multi-row statement.
 *
 * Postgres caps a statement at 65535 bind parameters, so the batch size is
 * derived from the column count rather than guessed — get this wrong and large
 * loads fail only once the data is big enough to matter.
 */
export async function bulkUpsert({ table, columns, rows, conflictTarget, updateColumns }) {
  if (!rows.length) return 0;

  const maxRowsPerStatement = Math.max(1, Math.floor(60000 / columns.length));
  let written = 0;

  for (let start = 0; start < rows.length; start += maxRowsPerStatement) {
    const chunk = rows.slice(start, start + maxRowsPerStatement);
    const params = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((col) => {
        // a column can supply raw SQL (e.g. ST_GeomFromGeoJSON($n)) via a
        // {sql, value} pair; otherwise it is a plain bind
        const cell = row[col];
        if (cell && typeof cell === 'object' && 'sql' in cell) {
          params.push(cell.value);
          return cell.sql.replace('?', `$${params.length}`);
        }
        params.push(cell === undefined ? null : cell);
        return `$${params.length}`;
      });
      return `(${placeholders.join(',')})`;
    });

    const setClause = (updateColumns ?? columns.filter((c) => !conflictTarget.includes(c)))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');

    const sql =
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ` +
      `ON CONFLICT (${conflictTarget.join(',')}) DO UPDATE SET ${setClause}`;

    const res = await query(sql, params);
    written += res.rowCount ?? chunk.length;
  }
  return written;
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
    await query(
      `INSERT INTO pipeline_runs (run_id, job_name, params, started_at, status)
       VALUES ($1,$2,$3,$4,'running')`,
      [this.runId, this.jobName, JSON.stringify(this.params), this.startedAt],
    );
    return this;
  }

  add(obj) {
    for (const [k, v] of Object.entries(obj)) this.counts[k] = (this.counts[k] ?? 0) + v;
  }

  async finish(error = null) {
    const finishedAt = new Date();
    const durationS = (finishedAt - this.startedAt) / 1000;
    const status = error ? 'failed' : this.counts.errors ? 'partial' : 'ok';
    await query(
      `UPDATE pipeline_runs
          SET finished_at=$1, duration_s=$2, status=$3, counts=$4, error=$5
        WHERE run_id=$6`,
      [
        finishedAt, durationS, status, JSON.stringify(this.counts),
        error ? String(error).slice(0, 500) : null, this.runId,
      ],
    );
    const summary = Object.entries(this.counts)
      .map(([k, v]) => `${k}=${v.toLocaleString()}`)
      .join(' ');
    console.log(`[${this.jobName}] ${status} in ${durationS.toFixed(1)}s  ${summary}`);
  }
}

export async function withRun(jobName, params, fn) {
  const run = await new RunLogger(jobName, params).start();
  try {
    const out = await fn(run);
    await run.finish();
    return out;
  } catch (err) {
    await run.finish(err);
    throw err;
  }
}
