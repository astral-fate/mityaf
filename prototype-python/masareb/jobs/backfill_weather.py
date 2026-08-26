"""ONE-TIME: pull the daily rain archive and derive rain events.

    python -m masareb.jobs.backfill_weather
"""
from __future__ import annotations

from masareb.config import settings
from masareb.store.db import RunLogger, get_conn, init_schema, write
from masareb.weather import openmeteo as om


def main(start: str = "2015-01-01") -> None:
    init_schema()
    with RunLogger("backfill_weather", {"start": start}) as run, write() as con:
        df = om.fetch_archive(start=start)
        df = om.add_rain_context(df)
        print(f"  archive : {len(df):,} days  {df['date'].min():%Y-%m-%d} -> {df['date'].max():%Y-%m-%d}")

        con.execute("DELETE FROM weather_daily")
        con.execute("""
            INSERT INTO weather_daily
              (date, precipitation_sum_mm, precipitation_hours, temperature_2m_max,
               temperature_2m_min, shortwave_radiation_sum, et0_fao_evapotranspiration,
               rain_72h_mm, days_since_rain)
            SELECT date, precipitation_sum, precipitation_hours, temperature_2m_max,
                   temperature_2m_min, shortwave_radiation_sum, et0_fao_evapotranspiration,
                   rain_72h_mm, days_since_rain
            FROM df
        """)
        run.add(rows_written=len(df))

        events = om.extract_rain_events(df)
        con.execute("DELETE FROM rain_events")
        if len(events):
            con.execute("""
                INSERT INTO rain_events
                  (rain_event_id, start_date, end_date, peak_date, total_mm, max_daily_mm)
                SELECT rain_event_id, start_date, end_date, peak_date, total_mm, max_daily_mm
                FROM events
            """)
        run.add(events=len(events))
        print(f"  events  : {len(events)} rain events >= {settings.rain_event_min_mm} mm")

        # what the platform actually cares about
        wet_days = int((df["precipitation_sum"].fillna(0) >= 1.0).sum())
        print(f"  wet days: {wet_days:,} of {len(df):,} "
              f"({100*wet_days/len(df):.1f}%) — a rainless gate is cheap here")

        print("\n  largest rain events on record:")
        for r in con.execute("""
            SELECT rain_event_id, peak_date, total_mm, max_daily_mm
            FROM rain_events ORDER BY total_mm DESC LIMIT 8
        """).fetchall():
            print(f"    {r[1]}   total {r[2]:6.1f} mm   peak day {r[3]:5.1f} mm")


if __name__ == "__main__":
    main()
