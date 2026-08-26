"""Overpass client — raw Overpass QL over requests.

Deliberately not osmnx: it pulls geopandas, which pulls pyproj, which has no
cp314 wheel. We only need geometry lists, and Overpass hands those over directly.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import requests

from masareb.config import settings

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Overpass sits behind Apache, which rejects the default python-requests
# User-Agent with a 406. OSM's usage policy asks for an identifying UA anyway.
HEADERS = {
    "User-Agent": "Masareb/1.0 (urban water monitoring, Al Madinah Municipality hackathon)",
    "Accept": "application/json",
}

RAW = settings.data_dir / "raw"

# highway classes we treat as drivable, with the half-width used to build a
# segment footprint for zonal statistics
ROAD_HALF_WIDTH_M: dict[str, float] = {
    "motorway": 20.0, "motorway_link": 12.0,
    "trunk": 20.0, "trunk_link": 12.0,
    "primary": 12.0, "primary_link": 9.0,
    "secondary": 10.0, "secondary_link": 8.0,
    "tertiary": 8.0, "tertiary_link": 7.0,
    "residential": 6.0, "unclassified": 6.0,
}

QUERIES: dict[str, str] = {
    "streets": """
        [out:json][timeout:180];
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]
           ["area"!~"yes"]({bbox});
        out geom;
    """,
    "green": """
        [out:json][timeout:180];
        (
          way["leisure"~"^(park|garden|pitch)$"]({bbox});
          way["landuse"~"^(grass|village_green|recreation_ground|forest)$"]({bbox});
        );
        out geom;
    """,
    "waterways": """
        [out:json][timeout:180];
        way["waterway"]({bbox});
        out geom;
    """,
}


def _post(query: str) -> dict[str, Any]:
    last: Exception | None = None
    for attempt, url in enumerate(ENDPOINTS * 2):
        try:
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=240)
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001 — any failure means try the mirror
            last = exc
            print(f"  [overpass] {url.split('//')[1].split('/')[0]} failed: "
                  f"{str(exc)[:80]} — retrying")
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"all Overpass endpoints failed: {last}")


def fetch(layer: str, refresh: bool = False) -> dict[str, Any]:
    """Fetch a layer, caching to disk. The cache is what makes the demo
    reproducible offline and protects against Overpass rate limits on the day."""
    RAW.mkdir(parents=True, exist_ok=True)
    cache = RAW / f"osm_{layer}.json"
    if cache.exists() and not refresh:
        data = json.loads(cache.read_text(encoding="utf-8"))
        print(f"  [overpass] {layer}: {len(data['elements'])} elements (cached)")
        return data

    query = QUERIES[layer].format(bbox=settings.overpass_bbox)
    data = _post(query)
    cache.write_text(json.dumps(data), encoding="utf-8")
    print(f"  [overpass] {layer}: {len(data['elements'])} elements (fetched)")
    return data


def ways_to_records(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten Overpass `out geom` ways into plain records with a coordinate list."""
    out: list[dict[str, Any]] = []
    for el in data.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
        if len(coords) < 2:
            continue
        tags = el.get("tags", {})
        out.append({
            "osm_id": el["id"],
            "coords": coords,
            "tags": tags,
            "name_ar": tags.get("name:ar") or tags.get("name"),
            "name_en": tags.get("name:en"),
            "highway": tags.get("highway"),
            "closed": coords[0] == coords[-1],
        })
    return out
