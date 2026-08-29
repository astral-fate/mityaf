/**
 * Pre-rain alerts: forecast × susceptibility.
 *
 * There is no public flood-alert feed to consume for this city. NCM publishes
 * warnings through its site and app, not an open API; the WMO Severe Weather
 * Information Centre's endpoints are dead; GDACS works but alerts on basin-scale
 * disasters — 487 live alerts and not one for Saudi Arabia, because urban
 * pluvial ponding is orders of magnitude below its threshold.
 *
 * That absence is the argument for generating alerts here rather than relaying
 * someone else's. A national warning says «rain expected over Madinah». The
 * question a dispatcher has is which streets, and only the susceptibility
 * ranking answers that. So:
 *
 *     alert = forecast rainfall  ×  the streets already ranked most exposed
 *
 * The forecast is the only non-satellite input in the early-warning path, and
 * deliberately so: revisit is days, a flash flood is hours. The satellite builds
 * the map; the forecast times the alarm.
 *
 * Three guards make this safe to run on a schedule rather than by hand:
 *
 *   persistence  a forecast that shows rain once and drops it next run is noise.
 *                An alert needs the same day to survive `minPersistence`
 *                consecutive runs before it is issued, tracked on the row.
 *   dedupe       one alert per district per forecast day, so re-running the
 *                pipeline does not re-alert.
 *   cooldown     after issuing, that key is quiet for `cooldownH`, so a forecast
 *                wobbling across the threshold cannot produce a stream.
 *
 * Nothing here is delivered anywhere. Rows are written with delivery_status
 * 'pending'; wiring a channel is a separate, deliberate step.
 */
import { bulkUpsert, query } from './db.js';
import { config } from './config.js';
import { fetchForecast } from './weather.js';

// Rainfall thresholds for a day's forecast, in mm. The lowest tier matches
// config.rain.eventMinMm — below the level that has historically produced a
// rain event, there is nothing worth waking anyone for.
const SEVERITY = [
  { at: 20.0, severity: 'critical' },
  { at: 10.0, severity: 'high' },
  { at: config.rain.eventMinMm, severity: 'moderate' },
];

const RULE_ID = 'prerain_v1';
const MIN_PERSISTENCE = 2;
const COOLDOWN_H = 18;
// Districts are ranked by candidate segments; alerting on all 91 is not an
// alert, it is a weather report.
const MAX_DISTRICTS = 8;

const severityOf = (mm) => SEVERITY.find((s) => mm >= s.at)?.severity ?? null;

// Latin digits, not Arabic-Indic. 'ar-SA' renders 6.2 as ٦٫٢, and every figure
// elsewhere in this product — the dashboard's .num cells, the deck — is Latin.
// An alert that numbers itself differently from the screen it links to reads as
// coming from a different system.
const ar = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });

/**
 * `forecast` is injectable so the alert path can be exercised against a wet
 * week. Madinah is dry for most of the year, so "it produced no alerts" is the
 * expected result almost every day — and a path that has only ever been watched
 * doing nothing has not been tested at all.
 */
export async function generatePreRainAlerts({ dryRun = false, forecast = null } = {}) {
  const fc = forecast ?? await fetchForecast(7);
  const days = fc?.daily?.time ?? [];
  const sums = fc?.daily?.precipitation_sum ?? [];
  const probs = fc?.daily?.precipitation_probability_max ?? [];

  const wet = days
    .map((date, i) => ({
      date,
      mm: sums[i] ?? 0,
      prob: probs[i] ?? null,
      severity: severityOf(sums[i] ?? 0),
    }))
    .filter((d) => d.severity);

  console.log(`  forecast: ${days.length} days, ` +
              `${wet.length} at or above ${config.rain.eventMinMm} mm`);
  if (!wet.length) {
    console.log('  no day crosses the threshold — no alert, which is the ' +
                'correct output most of the year');
    return { issued: 0, pending: 0, days: days.length };
  }

  // The districts that actually carry exposed streets, worst first.
  const { rows: districts } = await query(
    `SELECT u.district_ar                                   AS district,
            count(*) FILTER (WHERE r.risk_band IN ('critical','high')) AS n_exposed,
            count(*)                                        AS n_seg,
            (array_agg(u.unit_id ORDER BY r.risk_rank))[1:25] AS unit_ids
       FROM units u
       JOIN segment_risk r ON r.segment_unit_id = u.unit_id
      WHERE u.unit_type = 'segment' AND u.active
        AND u.district_ar IS NOT NULL
      GROUP BY u.district_ar
     HAVING count(*) FILTER (WHERE r.risk_band IN ('critical','high')) > 0
      ORDER BY n_exposed DESC
      LIMIT $1`,
    [MAX_DISTRICTS],
  );
  console.log(`  scope   : ${districts.length} districts carrying exposed streets`);

  const now = new Date();
  const rows = [];
  for (const d of wet) {
    const issueAt = new Date(`${d.date}T00:00:00Z`);
    const leadH = Math.round((issueAt - now) / 36e5);
    if (leadH < 0) continue;                 // today's rain is not a warning

    for (const g of districts) {
      const dedupe = `${RULE_ID}:${g.district}:${d.date}`;
      rows.push({
        alert_id: `alert_${RULE_ID}_${g.district}_${d.date}`.replace(/\s+/g, '_'),
        alert_type: 'pre_rain_ponding',
        module: 'ponding',
        severity: d.severity,
        // Held until persistence is met; promoted to 'issued' by the update
        // below once the same day has survived enough consecutive runs.
        status: 'pending',
        scope: 'district',
        district_ar: g.district,
        unit_ids: JSON.stringify(g.unit_ids ?? []),
        n_units: Number(g.n_exposed),
        issued_at: now.toISOString(),
        valid_until: new Date(issueAt.getTime() + 36 * 36e5).toISOString(),
        lead_time_h: leadH,
        rule_id: RULE_ID,
        trigger: JSON.stringify({
          forecastDate: d.date,
          forecastMm: d.mm,
          probabilityMax: d.prob,
          source: 'open_meteo_forecast',
          exposedSegments: Number(g.n_exposed),
        }),
        dedupe_key: dedupe,
        min_persistence_required: MIN_PERSISTENCE,
        channels: JSON.stringify(['dashboard']),
        delivery_status: 'pending',
        title_ar: `أمطار متوقّعة على ${g.district} — ${ar(d.mm)} ملم`,
        body_ar:
          `يتوقّع هطول ${ar(d.mm)} ملم يوم ${d.date}` +
          (d.prob !== null ? ` باحتمال ${ar(d.prob)}%` : '') +
          `. في ${g.district} ${ar(g.n_exposed)} مقطع شارع ضمن النطاقين الحرج ` +
          `والمرتفع، مرتّبة مسبقاً بقابليتها لاحتجاز الماء.`,
        action_ar:
          'ابدأ الدورية من أعلى القائمة المرتّبة، لا من أول بلاغ يصل. ' +
          'والمقاطع المصنّفة «منخفض مغلق» تحتاج شفطاً بعد الهطول، ' +
          'أمّا «ملتقى جريان» فيُعالَج باعتراض الجريان أعلى المنحدر.',
        deeplink: `/dashboard/segments?district=${encodeURIComponent(g.district)}&band=critical`,
      });
    }
  }

  if (!rows.length) {
    console.log('  every wet day is already in the past — nothing to warn about');
    return { issued: 0, pending: 0, days: days.length };
  }

  if (dryRun) {
    console.log(`  [dry run] would write ${rows.length} alert rows:`);
    for (const r of rows.slice(0, 5)) {
      console.log(`    ${r.severity.padEnd(8)} ${r.district_ar.padEnd(14)} ` +
                  `+${r.lead_time_h}h  ${r.title_ar}`);
    }
    return { issued: 0, pending: rows.length, days: days.length, dryRun: true };
  }

  await bulkUpsert({
    table: 'alerts',
    columns: Object.keys(rows[0]),
    rows,
    conflictTarget: ['alert_id'],
  });

  // Persistence and cooldown are resolved in SQL so a crashed run cannot leave
  // a half-counted alert: re-running is idempotent per dedupe_key.
  const { rows: promoted } = await query(
    `UPDATE alerts
        SET n_consecutive_triggers = COALESCE(n_consecutive_triggers, 0) + 1,
            status = CASE
              WHEN COALESCE(n_consecutive_triggers, 0) + 1 >= min_persistence_required
               AND (cooldown_until IS NULL OR cooldown_until < now())
              THEN 'issued' ELSE 'pending' END,
            cooldown_until = CASE
              WHEN COALESCE(n_consecutive_triggers, 0) + 1 >= min_persistence_required
               AND (cooldown_until IS NULL OR cooldown_until < now())
              THEN now() + ($2 || ' hours')::interval ELSE cooldown_until END
      WHERE rule_id = $1 AND status <> 'issued'
      RETURNING alert_id, status`,
    [RULE_ID, String(COOLDOWN_H)],
  );

  const issued = promoted.filter((r) => r.status === 'issued').length;
  const pending = promoted.length - issued;
  console.log(`  alerts  : ${issued} issued, ${pending} held for persistence ` +
              `(needs ${MIN_PERSISTENCE} consecutive runs)`);
  return { issued, pending, days: days.length };
}
