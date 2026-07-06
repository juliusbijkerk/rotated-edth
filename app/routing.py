"""Snap the leg between two fixes to the road network so trails follow streets,
not straight lines over buildings.

Uses the public OSRM demo server (driving profile, no API key). It's best-effort:
any failure (server down, timeout, no route) returns None and the caller draws a
straight line instead — routing must never block or break a report.

Note: the public OSRM demo only hosts the *driving* profile. Streets look right
for the demo; true pedestrian routing would need a keyed service (OpenRouteService
/ GraphHopper) — see TODO.
"""
from __future__ import annotations
from typing import Optional

import requests

_OSRM = "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}"


def route(lat1: float, lon1: float, lat2: float, lon2: float,
          timeout: float = 4.0) -> Optional[list]:
    """Return the routed path as [[lat, lon], ...] from (lat1,lon1) to (lat2,lon2), or None."""
    try:
        url = _OSRM.format(lon1=lon1, lat1=lat1, lon2=lon2, lat2=lat2)
        r = requests.get(url, params={"overview": "full", "geometries": "geojson"},
                         headers={"User-Agent": "ROTATED/0.1 (EDTH Paris 2026)"}, timeout=timeout)
        r.raise_for_status()
        routes = r.json().get("routes") or []
        if not routes:
            return None
        coords = routes[0]["geometry"]["coordinates"]  # GeoJSON [lon, lat]
        path = [[c[1], c[0]] for c in coords]           # -> [lat, lon] for Leaflet
        return path if len(path) >= 2 else None
    except Exception:
        return None
