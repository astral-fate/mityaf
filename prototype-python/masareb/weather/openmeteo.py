"""Open-Meteo archive + forecast.

This module carries more weight than its size suggests: `rain_72h_mm` and
`days_since_rain` are the discriminator that splits one satellite time series
into two products. Water on asphalt with rain = Module B. Without rain = Module A.
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import requests

from masareb.config import settings

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

DAILY_VARS = [
    "precipitation_sum",
    "precipitation_hours",
    "temperature_2m_max",
    "temperature_2m_min",
    "shortwave_radiation_sum",
    "et0_fao_evapotranspiration",
]


def fetch_archive(start: str = "2015-01-01", end: str | None = None) -> pd.DataFrame:
    """Daily history for the AOI centroid.

    The archive lags real time by ~5 days, so the end date is clamped — this is
    the same guard the prior palm pipeline used, and it stops a silent empty
    response when someone asks for today.
    """
    max_ok = pd.Timestamp.utcnow().tz_localize(None).normalize() - pd.Timedelta(days=6)
    end_ts = pd.Timestamp(end) if end else max_ok
    if end_ts > max_ok:
        print(f"  [weather] end clamped {end_ts.date()} -> {max_ok.date()} (archive lag)")
        end_ts = max_ok

    r = requests.get(
        ARCHIVE_URL,
        params={
            "latitude": settings.aoi_center_lat,
            "longitude": settings.aoi_center_lon,
            "start_date": start,
            "end_date": end_ts.strftime("%Y-%m-%d"),
            "daily": ",".join(DAILY_VARS),
            "timezone": "auto",
        },
        timeout=120,
    )
    r.raise_for_status()
    df = pd.DataFrame(r.json()["daily"]).rename(columns={"time": "date"})
    df["date"] = pd.to_datetime(df["date"])
    return df


def fetch_forecast(days: int = 7) -> dict:
    """Forecast drives the pre-rain alert. Note this is the ONLY part of the
    early-warning path that is not satellite-derived — and deliberately so:
    satellite revisit is days, a flash flood is hours."""
    r = requests.get(
        FORECAST_URL,
        params={
            "latitude": settings.aoi_center_lat,
            "longitude": settings.aoi_center_lon,
            "daily": "precipitation_sum,precipitation_hours,precipitation_probability_max",
            "hourly": "precipitation,precipitation_probability",
            "forecast_days": days,
            "timezone": "auto",
        },
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def add_rain_context(df: pd.DataFrame) -> pd.DataFrame:
    """Add the two fields every detector reads."""
    df = df.sort_values("date").reset_index(drop=True)
    p = df["precipitation_sum"].fillna(0.0)

    # rain in the trailing 72 h, inclusive of the day itself
    df["rain_72h_mm"] = p.rolling(window=3, min_periods=1).sum().round(2)

    # days since the last day that actually rained
    wet = p >= 0.5
    last_wet_idx = pd.Series(range(len(df))).where(wet.values).ffill()
    df["days_since_rain"] = (pd.Series(range(len(df))) - last_wet_idx).fillna(999).astype(int)
    return df


def extract_rain_events(df: pd.DataFrame, min_mm: float | None = None) -> pd.DataFrame:
    """Group consecutive wet days into events.

    An "event" is what we compare satellite scenes against, so it must be a real
    storm, not a trace. Consecutive wet days merge into one event because a
    two-day storm produces one ponding response, not two.
    """
    min_mm = min_mm or settings.rain_event_min_mm
    d = df.sort_values("date").reset_index(drop=True)
    wet = d["precipitation_sum"].fillna(0) >= 1.0

    events = []
    start = None
    for i, is_wet in enumerate(wet):
        if is_wet and start is None:
            start = i
        elif not is_wet and start is not None:
            events.append((start, i - 1))
            start = None
    if start is not None:
        events.append((start, len(d) - 1))

    rows = []
    for s, e in events:
        block = d.iloc[s : e + 1]
        total = float(block["precipitation_sum"].sum())
        if total < min_mm:
            continue
        peak = block.loc[block["precipitation_sum"].idxmax()]
        rows.append({
            "rain_event_id": f"rain_{block['date'].iloc[0]:%Y-%m-%d}",
            "start_date": block["date"].iloc[0].date(),
            "end_date": block["date"].iloc[-1].date(),
            "peak_date": peak["date"].date(),
            "total_mm": round(total, 2),
            "max_daily_mm": round(float(block["precipitation_sum"].max()), 2),
        })
    return pd.DataFrame(rows)


def discriminator_state(rain_72h_mm: float, days_since_rain: int) -> str:
    """The single decision that splits the platform into two products."""
    if rain_72h_mm >= settings.rainless_gate_mm:
        return "wet"
    if days_since_rain < settings.rainless_gate_days:
        return "recent_rain"
    return "rainless"
