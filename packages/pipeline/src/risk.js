/**
 * Load street-segment water-accumulation susceptibility into Postgres.
 *
 * The scoring itself lives in research/score_madinah.py, because the model is a
 * Python artefact and re-implementing an XGBoost forward pass in JS to avoid
 * one CSV would be a poor trade. This module owns the part that matters
 * operationally: getting 30,337 scored streets into the same table the map and
 * the API already read from.
 *
 * `risk_score` here is the PERCENTILE, not the model's raw probability. The
 * model was trained on New York and Chicago; the leave-one-city-out test says
 * the ORDERING transfers to an unseen city, and says nothing about whether an
 * absolute probability calibrated on Chicago rainfall means anything in a city
 * that rains eight days a year. Storing the rank keeps the claim to the one the
 * evidence supports.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { bulkUpsert, query } from './db.js';
import { config } from './config.js';

const MODEL_VERSION = 'pooled-nyc-chicago-v1';

/**
 * Minimal RFC4180 reader. The scored CSV carries a JSON column, so fields
 * contain commas and escaped quotes and cannot be split on ','.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  return rows.slice(1)
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

export async function loadSegmentRisk({ file = null } = {}) {
  const csvPath = file ?? path.join(
    config.repoRoot ?? process.cwd(), 'research', 'out', 'madinah_segment_risk.csv');

  let text;
  try {
    text = await fs.readFile(csvPath, 'utf8');
  } catch {
    console.log(`  no scored file at ${csvPath}`);
    console.log('  run: python research/score_madinah.py');
    return { loaded: 0 };
  }

  const rows = parseCsv(text);
  console.log(`  ${rows.length.toLocaleString()} scored segments in the file`);

  // Only score streets that actually exist as units: the features CSV was
  // built from an earlier OSM pull, and silently inserting a risk row for a
  // segment the map does not have would break the join without saying so.
  const { rows: known } = await query(
    `SELECT unit_id FROM units WHERE unit_type = 'segment' AND active`);
  const live = new Set(known.map((r) => r.unit_id));

  const out = [];
  let orphan = 0;
  for (const r of rows) {
    if (!live.has(r.unit_id)) { orphan++; continue; }
    out.push({
      segment_unit_id: r.unit_id,
      model_version: MODEL_VERSION,
      risk_score: num(r.risk_pct),
      risk_rank: num(r.risk_rank),
      risk_band: r.risk_band,
      f_twi: num(r.twi),
      f_hand_m: num(r.hand),
      f_sink_depth_m: num(r.sink),
      f_slope_pct: num(r.slope),
      top_drivers: r.top_drivers || '[]',
      recommended_action_ar: r.action_ar,
      action_rationale_ar: r.rationale_ar,
      requires_hydraulic_engineer: r.risk_band === 'critical',
    });
  }

  await bulkUpsert({
    table: 'segment_risk',
    columns: ['segment_unit_id', 'model_version', 'risk_score', 'risk_rank', 'risk_band',
      'f_twi', 'f_hand_m', 'f_sink_depth_m', 'f_slope_pct',
      'top_drivers', 'recommended_action_ar', 'action_rationale_ar',
      'requires_hydraulic_engineer'],
    rows: out,
    conflictTarget: ['segment_unit_id', 'model_version'],
  });

  const tally = out.reduce((a, r) => ({ ...a, [r.risk_band]: (a[r.risk_band] ?? 0) + 1 }), {});
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(12)} ${n.toLocaleString()}`);
  }
  if (orphan) {
    console.log(`  ${orphan.toLocaleString()} scored rows had no matching segment — skipped`);
  }
  console.log(`  loaded  : ${out.length.toLocaleString()} segments at model ${MODEL_VERSION}`);
  return { loaded: out.length, tally, orphan };
}
