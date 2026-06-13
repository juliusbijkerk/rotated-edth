#!/usr/bin/env python3
"""Fetch OSM POIs via Overpass API for an AO bbox, save as preset JSON.

Run once at setup. Output is committed to the repo so demo runtime does NOT call Overpass.

Usage:
    uv run python scripts/fetch_ao_preset.py paris_8
    uv run python scripts/fetch_ao_preset.py pokrovsk
    uv run python scripts/fetch_ao_preset.py all
    uv run python scripts/fetch_ao_preset.py all --force
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).parent.parent
PRESETS_DIR = PROJECT_ROOT / "app" / "presets"
PRESETS_DIR.mkdir(parents=True, exist_ok=True)

# Try mirrors in order; default Overpass returns 406 for default python-requests UA.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "Argus/0.1 (EDTH Paris 2026; juliusjacobbijkerk@gmail.com)"

# AO definitions. bbox = [west_lon, south_lat, east_lon, north_lat].
AO_DEFS = {
    "paris_8": {
        "name": "Paris 8th Arrondissement",
        "bbox": [2.3050, 48.8650, 2.3270, 48.8780],
        "center": [2.3138, 48.8722],
        "zoom": 16,
        "type": "urban",
    },
    "paris_central_demo": {
        "name": "Paris Central Demo",
        "bbox": [2.2850, 48.8450, 2.3700, 48.8950],
        "center": [2.3300, 48.8700],
        "zoom": 13,
        "type": "urban",
    },
    "pokrovsk": {
        "name": "Pokrovsk, Donetsk Oblast",
        "bbox": [37.150, 48.260, 37.230, 48.310],
        "center": [37.190, 48.285],
        "zoom": 14,
        "type": "rural",
    },
}

# Overpass query categories. Each line is a separate query, summed via the (…) union.
QUERIES = [
    'nwr["amenity"]',
    'nwr["tourism"]',
    'nwr["historic"]',
    'nwr["shop"]',
    'nwr["leisure"]',
    'nwr["natural"]',
    'nwr["waterway"]',
    'nwr["place"]',
    'nwr["railway"]',
    'nwr["public_transport"]',
    'nwr["bridge"="yes"]',
    'nwr["highway"]["name"]',
]

# What counts as the "primary" tag when classifying a feature.
PRIMARY_KEYS = (
    "amenity", "tourism", "historic", "shop", "public_transport",
    "railway", "leisure", "natural", "waterway", "place", "bridge", "highway",
)


def build_query(bbox: list[float]) -> str:
    west, south, east, north = bbox
    bbox_str = f"({south},{west},{north},{east})"
    body = "\n  ".join(f"{q}{bbox_str};" for q in QUERIES)
    return f"[out:json][timeout:90];\n(\n  {body}\n);\nout center;"


def normalize_name(name: str) -> str:
    n = name.lower().strip()
    for prefix in ("the ", "le ", "la ", "les ", "l'", "des "):
        if n.startswith(prefix):
            n = n[len(prefix):]
            break
    return re.sub(r"\s+", " ", n)


def primary_tag(tags: dict) -> str:
    for key in PRIMARY_KEYS:
        if key in tags:
            return f"{key}={tags[key]}"
    return "unknown"


def feature_aliases(name: str, tags: dict) -> list[str]:
    aliases: list[str] = []
    if "name:en" in tags:
        aliases.append(tags["name:en"])
    if "alt_name" in tags:
        aliases.extend(a.strip() for a in tags["alt_name"].split(";"))
    norm = normalize_name(name)
    if norm and norm != name.lower():
        aliases.append(norm)
    for sep in (" - ", " – "):
        if sep in name:
            aliases.extend(p.strip() for p in name.split(sep) if p.strip())
    seen: set[str] = set()
    out: list[str] = []
    for a in aliases:
        if a and a != name and a not in seen:
            seen.add(a)
            out.append(a)
    return out


def parse_elements(elements: list[dict]) -> list[dict]:
    pois: list[dict] = []
    seen_keys: set[tuple] = set()
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name:
            continue
        if el["type"] == "node":
            lat = el.get("lat")
            lon = el.get("lon")
        else:
            center = el.get("center") or {}
            lat = center.get("lat")
            lon = center.get("lon")
        if lat is None or lon is None:
            continue
        ptag = primary_tag(tags)
        key = (name.lower(), round(lat, 5), round(lon, 5))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        pois.append({
            "id": f"{el['type']}/{el['id']}",
            "name": name,
            "aliases": feature_aliases(name, tags),
            "type": ptag,
            "coords": [round(lon, 6), round(lat, 6)],
        })
    return pois


# Prominence ranking so the truncated LLM prompt + map overlay favour landmarks/transit
# over shops, and so a name with many nodes is represented by its most relevant one.
_PROM = {"place": 0, "railway": 1, "public_transport": 1, "aeroway": 1,
         "historic": 2, "tourism": 2, "natural": 3, "waterway": 3,
         "leisure": 4, "highway": 5, "shop": 6}
_AMENITY_PROMINENT = {"place_of_worship", "hospital", "school", "university",
                      "townhall", "police", "fire_station"}
_PRIORITY_NAME_HINTS = (
    "gare du nord",
    "gare saint-lazare",
    "saint-lazare",
    "tour eiffel",
    "eiffel tower",
    "madeleine",
    "arc de triomphe",
    "champs-élysées",
    "champs elysees",
    "concorde",
    "opéra",
    "opera",
    "louvre",
)


def prominence(poi_type: str) -> int:
    """Lower = more prominent."""
    key, _, sub = (poi_type or "").partition("=")
    if key == "railway" and sub in {"station", "train_station_entrance"}:
        return 0
    if key == "public_transport" and sub == "station":
        return 0
    if key == "amenity":
        return 2 if sub in _AMENITY_PROMINENT else 4
    return _PROM.get(key, 4)


def priority_name_score(poi: dict) -> int:
    haystack = " ".join([poi.get("name", ""), *poi.get("aliases", [])]).lower()
    for idx, hint in enumerate(_PRIORITY_NAME_HINTS):
        if hint in haystack:
            return idx
    return len(_PRIORITY_NAME_HINTS)


def dedupe_pois(pois: list[dict]) -> list[dict]:
    """Collapse same-named POIs (OSM has 100+ 'Madeleine' nodes) to one prominent
    representative, then order prominent-first so truncation keeps landmarks."""
    best: dict[str, dict] = {}
    for p in pois:
        name = p["name"]
        if name not in best or prominence(p["type"]) < prominence(best[name]["type"]):
            best[name] = p
    return sorted(best.values(), key=lambda p: (priority_name_score(p), prominence(p["type"]), p["name"]))


def fetch(ao_id: str) -> dict:
    ao = AO_DEFS[ao_id]
    query = build_query(ao["bbox"])
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    last_err: Exception | None = None
    data: dict | None = None
    for url in OVERPASS_URLS:
        print(f"[{ao_id}] querying {url}…", flush=True)
        try:
            r = requests.post(url, data={"data": query}, headers=headers, timeout=120)
            r.raise_for_status()
            data = r.json()
            break
        except Exception as e:
            print(f"[{ao_id}] mirror failed: {e}", flush=True)
            last_err = e
    if data is None:
        raise RuntimeError(f"all Overpass mirrors failed; last error: {last_err}")
    pois = dedupe_pois(parse_elements(data.get("elements", [])))
    print(f"[{ao_id}] {len(pois)} unique POIs (name-deduped, prominent-first)", flush=True)
    return {
        "id": ao_id,
        "name": ao["name"],
        "bbox": ao["bbox"],
        "center": ao["center"],
        "zoom": ao["zoom"],
        "type": ao["type"],
        "pois": pois,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("ao_id", choices=list(AO_DEFS) + ["all"])
    p.add_argument("--force", action="store_true",
                   help="Re-fetch even if preset file already exists.")
    args = p.parse_args()

    ids = list(AO_DEFS) if args.ao_id == "all" else [args.ao_id]
    failures = 0
    for ao_id in ids:
        out_path = PRESETS_DIR / f"{ao_id}.json"
        if out_path.exists() and not args.force:
            print(f"[{ao_id}] {out_path} exists, skipping (use --force).")
            continue
        try:
            preset = fetch(ao_id)
        except Exception as e:
            print(f"[{ao_id}] FAILED: {e}", file=sys.stderr)
            failures += 1
            continue
        out_path.write_text(json.dumps(preset, indent=2, ensure_ascii=False))
        print(f"[{ao_id}] wrote {out_path} ({len(preset['pois'])} POIs)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
