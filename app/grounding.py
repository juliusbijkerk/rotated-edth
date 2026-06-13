"""Grounding ladder: ParsedReport → ResolvedLocation (lat, lon)."""
from __future__ import annotations

from .geocoder import (
    bearing_word_to_deg, find_poi, haversine_destination,
    parse_coordinates, parse_mgrs,
)
from .units import UnitRegistry


def ground(parsed: dict, ao: dict, units: UnitRegistry, speaker: str) -> dict:
    """Run the grounding ladder. Returns dict with method, lat, lon, needs_review."""
    loc = parsed.get("location_reference") or {}
    ref_type = loc.get("type", "unresolved")
    raw = loc.get("raw_text", "") or ""
    pois = ao.get("pois", [])
    speaker_pos = units.last_position(speaker)
    near = (speaker_pos["lat"], speaker_pos["lon"]) if speaker_pos else None

    # 1. OSM POI
    if ref_type == "osm_poi":
        poi_name = loc.get("poi_name") or raw
        poi = find_poi(poi_name, pois, near_point=near)
        if poi:
            lon, lat = poi["coords"]
            return _ok("osm_poi", lat, lon, poi_name=poi["name"])

    # 2a. Coordinate
    if ref_type == "coordinate":
        coords = loc.get("coordinates")
        if coords and len(coords) == 2:
            lon, lat = coords
            return _ok("coordinate", float(lat), float(lon))
        latlon = parse_coordinates(raw)
        if latlon:
            return _ok("coordinate", latlon[0], latlon[1])

    # 2b. MGRS — function present but the parser may pick this rarely; falls through if invalid.
    if ref_type == "mgrs":
        mgrs_str = loc.get("mgrs") or raw
        latlon = parse_mgrs(mgrs_str)
        if latlon:
            return _ok("mgrs", latlon[0], latlon[1])

    # 3. Relative to another unit — wired but degrades gracefully if data missing.
    if ref_type == "relative_to_unit":
        ref_unit = loc.get("reference_unit")
        ref_pos = units.last_position(ref_unit) if ref_unit else None
        bearing = loc.get("bearing_deg")
        distance = loc.get("distance_m")
        if ref_pos and bearing is not None and distance is not None:
            lat, lon = haversine_destination(ref_pos["lat"], ref_pos["lon"],
                                             float(bearing), float(distance))
            return _ok("relative_to_unit", lat, lon, reference_unit=ref_unit)

    # 4. Relative to self / speaker
    if ref_type == "relative_to_self" and speaker_pos:
        bearing = loc.get("bearing_deg")
        distance = loc.get("distance_m") or 100.0  # Default 100m if unspecified.
        if bearing is None:
            for word in raw.lower().split():
                deg = bearing_word_to_deg(word)
                if deg is not None:
                    bearing = deg
                    break
        if bearing is not None:
            lat, lon = haversine_destination(speaker_pos["lat"], speaker_pos["lon"],
                                             float(bearing), float(distance))
            return _ok("relative_to_self", lat, lon)

    # Fallback: AO center, flagged for review.
    center_lon, center_lat = ao["center"]
    return {
        "method": "unresolved",
        "lat": center_lat,
        "lon": center_lon,
        "needs_review": True,
        "raw_text": raw,
    }


def _ok(method: str, lat: float, lon: float, **extra) -> dict:
    out = {"method": method, "lat": lat, "lon": lon, "needs_review": False}
    out.update(extra)
    return out
