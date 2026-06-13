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


def find_poi(query: str, pois: list[dict], min_score: int = 85,
             near_point: Optional[tuple[float, float]] = None) -> Optional[dict]:
    """Fuzzy-match a query against POI names + aliases. Returns best POI or None.

    Recall vs precision, in order:
      1. WRatio over name+aliases — recall gate (typos, tokens, substrings, cross-script
         aliases). A POI must clear `min_score` here to be considered at all.
      2. Among the WRatio band, prefer a strong match on the POI's *primary name*: a query
         that *is* a name ('Madeleine', the metro) beats one where the query is only a
         shared locality alias OSM hangs on nearby businesses ('Planet Sushi Paris -
         Madeleine' and 'Maison De La Truffe - Madeleine' are also tagged alias
         'Madeleine'). If no primary name matches well — the query hit via an alias, e.g.
         Latin 'Pokrovsk' -> Cyrillic 'Покровськ' — fall back to ranking by alias closeness.
      3. near_point distance — final tiebreak among equally-good names (several co-located
         POIs all literally named 'Madeleine'). Also makes the pick deterministic when
         near_point is None (a unit's first report), unlike the old arbitrary choice.

    min_score raised 75->85 so transliteration near-misses like 'Mykhailivka' ->
    'Михайла…вулиця' (WRatio 75) fall through the ladder instead of dropping a
    confidently-wrong marker ~2.8 km away.
    """
    if not query or not pois:
        return None
    q = query.strip()
    # A primary-name ratio at/above this means the query really names this POI (so prefer
    # it over alias-only matches). "Name + one descriptor" queries land ~75 (ratio of
    # 'Madeleine metro' vs 'Madeleine'); cross-script alias hits sit at ~0 ('Pokrovsk' vs
    # 'Покровськ') — 70 sits in the wide gap between, so it catches the former, not the latter.
    STRONG_NAME = 70
    scored: list[tuple[int, int, int, dict]] = []
    for poi in pois:
        name = poi.get("name") or ""
        aliases = [a for a in poi.get("aliases", []) if a]
        all_names = ([name] if name else []) + aliases
        wr = max((int(fuzz.WRatio(q, n)) for n in all_names), default=0)
        name_rt = int(fuzz.ratio(q, name)) if name else 0
        alias_rt = max((int(fuzz.ratio(q, a)) for a in aliases), default=0)
        scored.append((wr, name_rt, alias_rt, poi))
    scored.sort(key=lambda x: (-x[0], -x[1], -x[2]))
    if not scored or scored[0][0] < min_score:
        return None
    top_wr = scored[0][0]
    band = [s for s in scored if s[0] >= top_wr - 5]
    best_name_rt = max(s[1] for s in band)
    if best_name_rt >= STRONG_NAME:
        finalists = [s for s in band if s[1] >= best_name_rt - 5]   # query matched a primary name
    else:
        best_alias_rt = max(s[2] for s in band)                     # query matched via an alias
        finalists = [s for s in band if max(s[1], s[2]) >= best_alias_rt - 5]
    if near_point and len(finalists) > 1:
        plat, plon = near_point
        finalists.sort(key=lambda s: haversine_distance(
            plat, plon, s[3]["coords"][1], s[3]["coords"][0]))
    return finalists[0][3]


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
