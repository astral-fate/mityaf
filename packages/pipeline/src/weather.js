/**
 * Open-Meteo archive + forecast.
 *
 * This module carries more weight than its size suggests. `rain72hMm` and
 * `daysSinceRain` are the discriminator that splits one satellite time series
 * into two products — it is the core intellectual claim of the platform.
 *
 * Measured on the Madinah record: only 2.3% of days are wet, so the rainless
 * gate is open almost always and Module A can run on nearly every pass.
 */
import { bulkUpsert, query } from './db.js';
import { config } from './config.js';
import { fetchPowerDaily, reconcile } from './power.js';

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const DAILY_VARS = [
  'precipitation_sum',
  'precipitation_hours',
  'temperature_2m_max',
  'temperature_2m_min',
  'shortwave_radiation_sum',
  'et0_fao_evapotranspiration',
];

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Daily history for the AOI centroid. The archive lags real time by ~5 days, so
 * the end date is clamped — otherwise a request for "today" returns silently
 * empty.
 */
export async function fetchArchive({ start = '2015-01-01', end = null } = {}) {
  const maxOk = new Date(Date.now() - 6 * 864e5);
  let endDate = end ? new Date(end) : maxOk;
  if (endDate > maxOk) {
    console.log(`  [weather] end clamped ${iso(endDate)} -> ${iso(maxOk)} (archive lag)`);
    endDate = maxOk;
  }

  const params = new URLSearchParams({
    latitude: String(config.aoi.centerLat),
    longitude: String(config.aoi.centerLon),
    start_date: start,
    end_date: iso(endDate),
    daily: DAILY_VARS.join(','),
    timezone: 'auto',
  });

  const res = await fetch(`${ARCHIVE_URL}?${params}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Open-Meteo archive HTTP ${res.status}`);
  const { daily } = await res.json();

  return daily.time.map((t, i) => ({
    date: new Date(`${t}T00:00:00Z`),
    precipitationSumMm: daily.precipitation_sum?.[i] ?? 0,
    precipitationHours: daily.precipitation_hours?.[i] ?? 0,
    temperature2mMax: daily.temperature_2m_max?.[i] ?? null,
    temperature2mMin: daily.temperature_2m_min?.[i] ?? null,
    shortwaveRadiationSum: daily.shortwave_radiation_sum?.[i] ?? null,
    et0Fao: daily.et0_fao_evapotranspiration?.[i] ?? null,
  }));
}

/**
 * Forecast drives the pre-rain alert. Note this is the ONLY part of the
 * early-warning path that is not satellite-derived, and deliberately so:
 * satellite revisit is days, a flash flood is hours. The satellite builds the
 * susceptibility map; the forecast times the alarm.
 */
export async function fetchForecast(days = 7) {
  const params = new URLSearchParams({
    latitude: String(config.aoi.centerLat),
    longitude: String(config.aoi.centerLon),
    daily: 'precipitation_sum,precipitation_hours,precipitation_probability_max',
    hourly: 'precipitation,precipitation_probability',
    forecast_days: String(days),
    timezone: 'auto',
  });
  const res = await fetch(`${FORECAST_URL}?${params}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
  return res.json();
}

/** Add the two fields every detector reads. */
export function addRainContext(rows) {
  const sorted = [...rows].sort((a, b) => a.date - b.date);
  let lastWetIdx = null;

  return sorted.map((row, i) => {
    // trailing 72 h, inclusive of the day itself
    let sum = 0;
    for (let j = Math.max(0, i - 2); j <= i; j++) sum += sorted[j].precipitationSumMm ?? 0;

    if ((row.precipitationSumMm ?? 0) >= 0.5) lastWetIdx = i;
    const daysSinceRain = lastWetIdx === null ? 999 : i - lastWetIdx;

    return { ...row, rain72hMm: Math.round(sum * 100) / 100, daysSinceRain };
  });
}

/**
 * Group consecutive wet days into events. Consecutive days merge because a
 * two-day storm produces one ponding response, not two — and the event is the
 * unit we compare satellite scenes against.
 */
export function extractRainEvents(rows, minMm = config.rain.eventMinMm) {
  const sorted = [...rows].sort((a, b) => a.date - b.date);
  const wet = sorted.map((r) => (r.precipitationSumMm ?? 0) >= 1.0);

  const spans = [];
  let start = null;
  wet.forEach((isWet, i) => {
    if (isWet && start === null) start = i;
    else if (!isWet && start !== null) {
      spans.push([start, i - 1]);
      start = null;
    }
  });
  if (start !== null) spans.push([start, sorted.length - 1]);

  const events = [];
  for (const [s, e] of spans) {
    const block = sorted.slice(s, e + 1);
    const total = block.reduce((a, r) => a + (r.precipitationSumMm ?? 0), 0);
    if (total < minMm) continue;
    const peak = block.reduce((a, b) => (b.precipitationSumMm > a.precipitationSumMm ? b : a));
    events.push({
      rainEventId: `rain_${iso(block[0].date)}`,
      startDate: block[0].date,
      endDate: block[block.length - 1].date,
      peakDate: peak.date,
      totalMm: Math.round(total * 100) / 100,
      maxDailyMm: Math.round(peak.precipitationSumMm * 100) / 100,
    });
  }
  return events;
}

/** The single decision that splits the platform into two products. */
export function discriminatorState(rain72hMm, daysSinceRain) {
  if (rain72hMm >= config.rain.rainlessGateMm) return 'wet';
  if (daysSinceRain < config.rain.rainlessGateDays) return 'recent_rain';
  return 'rainless';
}

export async function backfill({ start = '2015-01-01' } = {}) {
  const rows = addRainContext(await fetchArchive({ start }));
  console.log(`  archive : ${rows.length.toLocaleString()} days  ` +
              `${iso(rows[0].date)} -> ${iso(rows[rows.length - 1].date)}`);

  // Second source. Open-Meteo's archive endpoint also clamps ~6 days behind
  // real time, so the most recent week is exactly where a single source is
  // weakest — and it is the week an operator is actually asking about.
  let power = new Map();
  try {
    const got = await fetchPowerDaily({
      start, end: iso(new Date()),
    });
    power = new Map(got.map((r) => [r.date, r.powerMm]));
    console.log(`  power   : ${power.size.toLocaleString()} days from NASA POWER`);
  } catch (err) {
    // A second opinion is an upgrade, not a dependency: losing it must not
    // cost us the archive we already fetched.
    console.log(`  power   : unavailable (${err.message}) — continuing on Open-Meteo alone`);
  }

  let missed = 0;
  const merged = rows.map((r) => {
    const d = iso(r.date);
    const p = power.get(d);
    const rec = reconcile(r.precipitationSumMm, p);
    if (p > 0 && !(r.precipitationSumMm > 0)) missed += 1;
    return { ...r, powerMm: p ?? null, best: rec };
  });

  // POWER publishes past the archive's 6-day clamp, and those trailing days are
  // the ones an operator asks about — «did it rain this week». Iterating only
  // the archive silently dropped them: POWER had 2026-08-26 while the archive
  // stopped at 08-23, so the one day someone remembered rain was the one day
  // never written. Carry the tail, with the Open-Meteo columns left null rather
  // than zeroed, because we did not measure them — we simply have no reading.
  const have = new Set(rows.map((r) => iso(r.date)));
  const tail = [...power.entries()]
    .filter(([d]) => !have.has(d))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([d, mm]) => ({
      date: new Date(`${d}T00:00:00Z`),
      precipitationSumMm: null,
      precipitationHours: null,
      temperature2mMax: null,
      temperature2mMin: null,
      shortwaveRadiationSum: null,
      et0Fao: null,
      rain72hMm: null,
      daysSinceRain: null,
      powerMm: mm,
      best: reconcile(null, mm),
    }));
  if (tail.length) {
    const wet = tail.filter((r) => r.powerMm > 0);
    console.log(`  tail    : ${tail.length} day(s) past the archive clamp, from POWER only` +
                (wet.length ? ` — ${wet.map((r) => `${iso(r.date)} ${r.powerMm}mm`).join(', ')}` : ''));
    merged.push(...tail);
  }
  if (missed) {
    console.log(`  ${missed} day(s) where POWER saw rain and Open-Meteo saw none ` +
                `— kept, because a missed cell is the failure mode that matters`);
  }

  await bulkUpsert({
    table: 'weather_daily',
    columns: ['date', 'precipitation_sum_mm', 'precipitation_hours',
              'temperature_2m_max', 'temperature_2m_min', 'shortwave_radiation_sum',
              'et0_fao', 'rain_72h_mm', 'days_since_rain',
              'power_precip_mm', 'precip_best_mm', 'precip_disagree_mm'],
    rows: merged.map((r) => ({
      date: iso(r.date),
      precipitation_sum_mm: r.precipitationSumMm,
      precipitation_hours: r.precipitationHours,
      temperature_2m_max: r.temperature2mMax,
      temperature_2m_min: r.temperature2mMin,
      shortwave_radiation_sum: r.shortwaveRadiationSum,
      et0_fao: r.et0Fao,
      rain_72h_mm: r.rain72hMm,
      days_since_rain: r.daysSinceRain,
      power_precip_mm: r.powerMm,
      precip_best_mm: r.best.mm,
      precip_disagree_mm: r.best.disagreeMm,
    })),
    conflictTarget: ['date'],
  });

  const events = extractRainEvents(rows);
  if (events.length) {
    await bulkUpsert({
      table: 'rain_events',
      columns: ['rain_event_id', 'start_date', 'end_date', 'peak_date', 'total_mm', 'max_daily_mm'],
      rows: events.map((e) => ({
        rain_event_id: e.rainEventId,
        start_date: iso(e.startDate),
        end_date: iso(e.endDate),
        peak_date: iso(e.peakDate),
        total_mm: e.totalMm,
        max_daily_mm: e.maxDailyMm,
      })),
      conflictTarget: ['rain_event_id'],
    });
  }
  console.log(`  events  : ${events.length} rain events >= ${config.rain.eventMinMm} mm`);

  const wetDays = rows.filter((r) => (r.precipitationSumMm ?? 0) >= 1.0).length;
  const pct = ((100 * wetDays) / rows.length).toFixed(1);
  console.log(`  wet days: ${wetDays.toLocaleString()} of ${rows.length.toLocaleString()} ` +
              `(${pct}%) - the rainless gate is cheap here`);

  const { rows: top } = await query(
    `SELECT peak_date, total_mm, max_daily_mm FROM rain_events
      ORDER BY total_mm DESC LIMIT 6`);
  console.log('\n  largest rain events on record:');
  for (const e of top) {
    console.log(`    ${iso(new Date(e.peak_date))}   total ${String(e.total_mm).padStart(6)} mm   ` +
                `peak day ${String(e.max_daily_mm).padStart(5)} mm`);
  }

  return { days: rows.length, events: events.length };
}
