"""Split street centrelines into fixed-length analysis units.

A whole OSM way is the wrong unit of analysis: ways run for kilometres and mix a
flood-prone dip with dry high ground. Fixed ~200 m segments give the municipality
something they can actually act on ("this 200 m of شارع X"), and they are large
enough to hold several 10 m pixels.
"""
from __future__ import annotations

from typing import Any, Iterator

from shapely.geometry import LineString
from shapely.ops import substring

from masareb.config import settings
from masareb.osm.overpass import ROAD_HALF_WIDTH_M

# metres per degree, at Madinah's latitude (~24.47 N). Good to ~0.1% locally,
# and only used to convert a target length into the degree-space substring call.
M_PER_DEG_LAT = 110_949.0
M_PER_DEG_LON = 101_318.0


def _line_length_m(line: LineString) -> float:
    """Approximate length in metres of a 4326 LineString using a local scale."""
    total = 0.0
    xs, ys = line.xy
    for i in range(len(xs) - 1):
        dx = (xs[i + 1] - xs[i]) * M_PER_DEG_LON
        dy = (ys[i + 1] - ys[i]) * M_PER_DEG_LAT
        total += (dx * dx + dy * dy) ** 0.5
    return total


def split_way(
    coords: list[tuple[float, float]],
    target_m: float | None = None,
    min_m: float | None = None,
) -> Iterator[tuple[int, LineString, float]]:
    """Yield (index, piece, length_m) for one way."""
    target_m = target_m or settings.segment_length_m
    min_m = min_m or settings.segment_min_length_m

    line = LineString(coords)
    total_m = _line_length_m(line)
    if total_m < min_m:
        return

    n = max(1, round(total_m / target_m))
    step = line.length / n          # in degree-space, but proportional
    for i in range(n):
        piece = substring(line, i * step, (i + 1) * step)
        if piece.is_empty or piece.geom_type != "LineString":
            continue
        piece_m = _line_length_m(piece)
        if piece_m < min_m and n > 1:
            continue
        yield i, piece, piece_m


def build_segments(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Turn OSM way records into segment units."""
    segments: list[dict[str, Any]] = []
    for rec in records:
        if rec["closed"]:            # roundabouts / service loops: not useful units
            continue
        hw = rec.get("highway") or "unclassified"
        half_w = ROAD_HALF_WIDTH_M.get(hw, 6.0)
        for i, piece, piece_m in split_way(rec["coords"]):
            segments.append({
                "unit_id": f"seg_{rec['osm_id']}_{i:02d}",
                "unit_type": "segment",
                "name_ar": rec.get("name_ar"),
                "name_en": rec.get("name_en"),
                "source": "osm",
                "source_ref": str(rec["osm_id"]),
                "wkt": piece.wkt,
                "length_m": round(piece_m, 1),
                "highway_class": hw,
                "half_width_m": half_w,
                "centroid_lon": piece.centroid.x,
                "centroid_lat": piece.centroid.y,
            })
    return segments
