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
import { collections, connect } from './db.js';
import { config } from './config.js';

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
  const d = await connect();

  const rows = addRainContext(await fetchArchive({ start }));
  console.log(`  archive : ${rows.length.toLocaleString()} days  ` +
              `${iso(rows[0].date)} -> ${iso(rows[rows.length - 1].date)}`);

  await d.collection(collections.weatherDaily).deleteMany({});
  await d.collection(collections.weatherDaily).insertMany(rows, { ordered: false });

  const events = extractRainEvents(rows);
  await d.collection(collections.rainEvents).deleteMany({});
  if (events.length) {
    await d.collection(collections.rainEvents).insertMany(events, { ordered: false });
  }
  console.log(`  events  : ${events.length} rain events >= ${config.rain.eventMinMm} mm`);

  const wetDays = rows.filter((r) => (r.precipitationSumMm ?? 0) >= 1.0).length;
  const pct = ((100 * wetDays) / rows.length).toFixed(1);
  console.log(`  wet days: ${wetDays.toLocaleString()} of ${rows.length.toLocaleString()} ` +
              `(${pct}%) — the rainless gate is cheap here`);

  const top = [...events].sort((a, b) => b.totalMm - a.totalMm).slice(0, 6);
  console.log('\n  largest rain events on record:');
  for (const e of top) {
    console.log(`    ${iso(e.peakDate)}   total ${String(e.totalMm).padStart(6)} mm   ` +
                `peak day ${String(e.maxDailyMm).padStart(5)} mm`);
  }

  return { days: rows.length, events: events.length };
}
