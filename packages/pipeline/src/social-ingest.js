/**
 * Ingest citizen reports, classify them, and cluster them into district alerts.
 *
 * Picks its source at run time: the live X API when X_BEARER_TOKEN is present,
 * the synthetic corpus otherwise. The chosen source is recorded on the output
 * so nothing downstream can present sample data as live, and the dashboard
 * says which one it is looking at.
 */
import { bulkUpsert, query } from './db.js';
import { buildAlerts, classifyPost, fetchFromX, MADINAH_QUERY } from './social.js';
import { sampleFeed } from './social-sample.js';

export async function ingestSocial({ maxResults = 100 } = {}) {
  const token = process.env.X_BEARER_TOKEN ?? null;

  // District names come from the database, so the extractor matches exactly
  // the strings the map and the tables use — no second list to drift.
  const { rows: dRows } = await query(
    `SELECT name_ar FROM units WHERE unit_type = 'district' AND active ORDER BY name_ar`);
  const districts = dRows.map((r) => r.name_ar).filter(Boolean);

  let raw;
  let source;
  if (token) {
    try {
      raw = await fetchFromX({ query: MADINAH_QUERY, maxResults, token });
      source = 'x';
      console.log(`  [x] ${raw.length} posts from the live API`);
    } catch (err) {
      console.log(`  [x] live fetch failed (${String(err.message).slice(0, 80)}) — using sample`);
      raw = sampleFeed();
      source = 'sample';
    }
  } else {
    raw = sampleFeed();
    source = 'sample';
    console.log(`  [sample] ${raw.length} synthetic posts — set X_BEARER_TOKEN for live`);
  }

  const posts = raw.map((p) => {
    const c = classifyPost(p.text, districts);
    return {
      ...p,
      ...c,
      // The corpus carries a hint so the sample exercises alert clustering even
      // where a post does not name its district in the prose. It never
      // overrides an extraction: a real post is classified only on its text.
      district: c.district ?? (p.source === 'sample' ? p.hintDistrict ?? null : null),
    };
  });

  const alerts = buildAlerts(posts);

  await bulkUpsert({
    table: 'social_reports',
    columns: ['report_id', 'source', 'synthetic', 'author', 'text_raw', 'created_at',
      'category', 'district_ar', 'urgency', 'level', 'matched_terms', 'explanation_ar'],
    rows: posts.map((p) => ({
      report_id: `${p.source}_${p.id}`,
      source: p.source,
      synthetic: p.synthetic,
      author: p.author,
      text_raw: p.text,
      created_at: p.createdAt,
      category: p.category,
      district_ar: p.district,
      urgency: p.urgency,
      level: p.level,
      matched_terms: JSON.stringify({ matched: p.matched, intensifiers: p.intensifiers, negated: p.negated }),
      explanation_ar: p.explanationAr,
    })),
    conflictTarget: ['report_id'],
  });

  const byCat = posts.reduce((a, p) => ({ ...a, [p.category]: (a[p.category] ?? 0) + 1 }), {});
  for (const [k, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(14)} ${n}`);
  }
  console.log(`  alerts: ${alerts.length}`);
  for (const a of alerts.slice(0, 5)) console.log(`    [${a.level}] ${a.titleAr}`);

  return { posts: posts.length, alerts: alerts.length, source };
}
