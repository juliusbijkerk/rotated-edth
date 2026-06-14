#!/usr/bin/env python3
"""Fetch named bridges (with proper geometry) for an AO bbox via Overpass.

Bridges in the AO preset come through as transit nodes (subway entrances etc.)
— we need actual bridge ways/polygons with names for a useful bridges overlay.

Usage:  uv run python scripts/fetch_bridges.py <ao_id>
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
PRESETS = ROOT / "app" / "presets"

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = "Argus/0.1 (EDTH Paris 2026; juliusjacobbijkerk@gmail.com)"


def fetch(ao_id: str) -> dict:
    preset = json.loads((PRESETS / f"{ao_id}.json").read_text())
    w, s, e, n = preset["bbox"]
    bbox = f"({s},{w},{n},{e})"
    # Real bridge geometries: ways/relations tagged as bridges OR carrying a road across one.
    # Filter to named features so we only show useful labels.
    q = f"""[out:json][timeout:90];
(
  way["bridge"]["name"]{bbox};
  way["man_made"="bridge"]["name"]{bbox};
  relation["man_made"="bridge"]["name"]{bbox};
  way["highway"]["bridge"="yes"]["name"]{bbox};
  way["railway"]["bridge"="yes"]["name"]{bbox};
);
out geom;"""
    data = None
    for url in OVERPASS:
        print(f"[{ao_id}] {url}…", flush=True)
        try:
            r = requests.post(url, data={"data": q},
                              headers={"User-Agent": UA, "Accept": "application/json"}, timeout=120)
            r.raise_for_status()
            data = r.json(); break
        except Exception as ex:
            print(f"   miss: {ex}")
    if data is None:
        raise RuntimeError("all Overpass mirrors failed")

    feats, seen = [], set()
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        if el["type"] == "way" and el.get("geometry"):
            coords = [[g["lon"], g["lat"]] for g in el["geometry"]]
            geom = {"type": "LineString", "coordinates": coords}
        elif el["type"] == "relation" and el.get("members"):
            # First named geometric member as a representative line
            ways = [m for m in el["members"] if m.get("type") == "way" and m.get("geometry")]
            if not ways:
                continue
            coords = [[g["lon"], g["lat"]] for g in ways[0]["geometry"]]
            geom = {"type": "LineString", "coordinates": coords}
        else:
            continue
        feats.append({
            "type": "Feature",
            "properties": {"name": name, "name_en": tags.get("name:en"), "kind": tags.get("bridge") or tags.get("man_made") or "bridge"},
            "geometry": geom,
        })
    return {"type": "FeatureCollection", "features": feats}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ao_id")
    args = ap.parse_args()
    out_path = PRESETS / f"{args.ao_id}_bridges.geojson"
    geo = fetch(args.ao_id)
    out_path.write_text(json.dumps(geo, ensure_ascii=False))
    print(f"[{args.ao_id}] {len(geo['features'])} named bridges -> {out_path}")


if __name__ == "__main__":
    sys.exit(main() or 0)
