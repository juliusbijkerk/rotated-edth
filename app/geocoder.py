"""Coordinate parsing, POI fuzzy match, haversine math."""
from __future__ import annotations
import math
import re
from typing import Optional

import mgrs as mgrs_lib
from rapidfuzz import fuzz

EARTH_R = 6371000.0  # meters

# Bearing word → degrees clockwise from north.
BEARING_WORDS = {
    "n": 0, "north": 0, "nne": 22.5,
    "ne": 45, "northeast": 45, "ene": 67.5,
    "e": 90, "east": 90, "ese": 112.5,
    "se": 135, "southeast": 135, "sse": 157.5,
    "s": 180, "south": 180, "ssw": 202.5,
    "sw": 225, "southwest": 225, "wsw": 247.5,
    "w": 270, "west": 270, "wnw": 292.5,
    "nw": 315, "northwest": 315, "nnw": 337.5,
}


def haversine_destination(lat: float, lon: float, bearing_deg: float,
                          distance_m: float) -> tuple[float, float]:
    """Forward geodetic: given start lat/lon, bearing, distance → new lat/lon."""
    phi1 = math.radians(lat)
    lam1 = math.radians(lon)
    theta = math.radians(bearing_deg)
    delta = distance_m / EARTH_R
    phi2 = math.asin(math.sin(phi1) * math.cos(delta)
                     + math.cos(phi1) * math.sin(delta) * math.cos(theta))
    lam2 = lam1 + math.atan2(math.sin(theta) * math.sin(delta) * math.cos(phi1),
                             math.cos(delta) - math.sin(phi1) * math.sin(phi2))
    return (math.degrees(phi2), math.degrees(lam2))


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def bearing_word_to_deg(word: str) -> Optional[float]:
    return BEARING_WORDS.get(word.lower().strip(".,!?;:"))


def find_poi(query: str, pois: list[dict], min_score: int = 75,
             near_point: Optional[tuple[float, float]] = None) -> Optional[dict]:
    """Fuzzy-match a query against POI names + aliases.

    Returns the best POI or None. If multiple are tied within 5 points,
    `near_point` (lat, lon) is used as a tiebreak (closest wins).
    """
    if not query or not pois:
        return None
    candidates: list[tuple[int, dict]] = []
    q = query.strip()
    for poi in pois:
        names = [poi["name"]] + list(poi.get("aliases", []))
        score = max((int(fuzz.WRatio(q, n)) for n in names if n), default=0)
        candidates.append((score, poi))
    candidates.sort(key=lambda x: -x[0])
    if not candidates or candidates[0][0] < min_score:
        return None
    top_score = candidates[0][0]
    top = [c for c in candidates if c[0] >= top_score - 5]
    if near_point and len(top) > 1:
        plat, plon = near_point
        top.sort(key=lambda c: haversine_distance(plat, plon, c[1]["coords"][1], c[1]["coords"][0]))
    return top[0][1]


# Decimal-degree pattern e.g. "48.8738, 2.2950" or "48.8738N, 2.2950E".
_COORD_RE = re.compile(
    r"(-?\d{1,3}\.\d+)\s*[°]?\s*([NS])?\s*[, ]+\s*(-?\d{1,3}\.\d+)\s*[°]?\s*([EW])?",
    re.IGNORECASE,
)


def parse_coordinates(text: str) -> Optional[tuple[float, float]]:
    """Extract decimal lat/lon from free text. Returns (lat, lon) or None."""
    m = _COORD_RE.search(text)
    if not m:
        return None
    lat = float(m.group(1))
    if m.group(2) and m.group(2).upper() == "S":
        lat = -lat
    lon = float(m.group(3))
    if m.group(4) and m.group(4).upper() == "W":
        lon = -lon
    if -90 <= lat <= 90 and -180 <= lon <= 180:
        return (lat, lon)
    return None


_MGRS = mgrs_lib.MGRS()


def parse_mgrs(text: str) -> Optional[tuple[float, float]]:
    """Extract MGRS grid reference, convert to lat/lon."""
    candidate = re.sub(r"\s+", "", text)
    m = re.search(r"(\d{1,2}[C-X][A-HJ-NP-Z]{2}\d{2,10})", candidate, re.IGNORECASE)
    if not m:
        return None
    try:
        lat, lon = _MGRS.toLatLon(m.group(1).upper())
        return (float(lat), float(lon))
    except Exception:
        return None
