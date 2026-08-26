"""Central configuration. Everything tunable lives here or in .env — no magic
numbers scattered through the detectors."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ── paths ──
    root: Path = ROOT
    data_dir: Path = ROOT / "data"
    db_path: Path = ROOT / "data" / "masareb.duckdb"

    # ── Earth Engine ──
    gee_project: str = "dotted-medley-467420-k3"
    gee_service_account_json: str | None = None
    gee_chunk_size: int = 400          # units per reduceRegions call
    gee_max_workers: int = 8

    # ── area of interest: Al Madinah urban envelope ──
    # 39.50-39.72 E, 24.36-24.58 N  ->  ~22 x 24 km
    aoi_min_lon: float = 39.50
    aoi_min_lat: float = 24.36
    aoi_max_lon: float = 39.72
    aoi_max_lat: float = 24.58
    aoi_center_lat: float = 24.47
    aoi_center_lon: float = 39.61

    # CRS: geometry is stored in 4326; every metric operation transforms to UTM 37N.
    crs_geographic: str = "EPSG:4326"
    crs_metric: str = "EPSG:32637"

    # ── collections ──
    s2_collection: str = "COPERNICUS/S2_SR_HARMONIZED"
    s2_cloudprob_collection: str = "COPERNICUS/S2_CLOUD_PROBABILITY"
    s1_collection: str = "COPERNICUS/S1_GRD"
    dem_collection: str = "COPERNICUS/DEM/GLO30"
    worldcover_collection: str = "ESA/WorldCover/v200"
    dynamicworld_collection: str = "GOOGLE/DYNAMICWORLD/V1"

    # ── unit geometry ──
    ring_outer_m: float = 20.0    # spill ring extends 20 m beyond the green polygon
    ring_inner_m: float = 2.0     # ...but starts 2 m out, to skip the mixed edge pixel
    segment_length_m: float = 200.0
    segment_min_length_m: float = 40.0
    green_min_area_m2: float = 200.0
    green_max_area_m2: float = 200_000.0
    green_ndvi_threshold: float = 0.25

    # ── the module discriminator (BP-01 vs BP-02) ──
    rainless_gate_mm: float = 1.0      # rain in the last 72 h below this = "rainless"
    rainless_gate_days: int = 3        # ...and at least this many days since rain
    rain_event_min_mm: float = 5.0     # daily total that counts as a rain event

    # ── Module A: waste ──
    waste_z_threshold: float = 2.0            # ring wetness sigma above own baseline
    waste_min_consecutive_passes: int = 2     # never fire on a single scene
    baseline_window: int = 12                 # rolling window, in weekly steps
    baseline_min_periods: int = 4
    baseline_sigma_mult: float = 1.5

    # ── Module B: ponding (SAR) ──
    # Water in the open goes DARK. Water between buildings goes BRIGHT, because the
    # flat surface plus a vertical wall forms a dihedral corner reflector. A naive
    # "dark = water" detector misses exactly the streets that matter, so the sign is
    # chosen by built fraction, never globally.
    sar_open_threshold_db: float = -3.0
    sar_urban_threshold_db: float = 2.5
    sar_built_frac_split: float = 0.40
    sar_incidence_min_deg: float = 15.0   # below -> layover
    sar_incidence_max_deg: float = 75.0   # above -> shadow

    # ── honesty gates ──
    min_observation_coverage: float = 0.30   # below this a segment can never be "stable"
    min_valid_pixel_frac: float = 0.60       # below this an observation is not scored

    # ── alerts ──
    alerts_enabled: bool = True
    alerts_dry_run: bool = False
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    scheduler_enabled: bool = True

    # ── api ──
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def aoi_bbox(self) -> tuple[float, float, float, float]:
        return (self.aoi_min_lon, self.aoi_min_lat, self.aoi_max_lon, self.aoi_max_lat)

    @property
    def overpass_bbox(self) -> str:
        """Overpass wants (south,west,north,east)."""
        return f"{self.aoi_min_lat},{self.aoi_min_lon},{self.aoi_max_lat},{self.aoi_max_lon}"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
