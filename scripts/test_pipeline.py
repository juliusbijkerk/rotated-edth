#!/usr/bin/env python3
"""Offline smoke test: WAV + AO → transcript → parsed → grounded.

Usage:
    uv run python scripts/test_pipeline.py path/to/audio.wav --ao paris_8 --speaker Alpha
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv  # noqa: E402

from app import grounding, parser as llm_parser, stt  # noqa: E402
from app.units import UnitRegistry  # noqa: E402


def main():
    load_dotenv()
    p = argparse.ArgumentParser()
    p.add_argument("audio")
    p.add_argument("--ao", default="paris_8")
    p.add_argument("--speaker", default="Alpha")
    p.add_argument("--no-llm", action="store_true",
                   help="Skip the LLM parse step (useful if ANTHROPIC_API_KEY is not set).")
    args = p.parse_args()

    preset_path = PROJECT_ROOT / "app" / "presets" / f"{args.ao}.json"
    ao = json.loads(preset_path.read_text())
    units = UnitRegistry()

    # Seed speaker at AO center so the relative_to_self branch has an anchor.
    center_lon, center_lat = ao["center"]
    units.append_position(args.speaker, center_lat, center_lon)

    print(f"[stt] transcribing {args.audio}…", flush=True)
    text = stt.transcribe(args.audio)
    print(f"[stt] {text!r}", flush=True)

    if args.no_llm or not os.environ.get("ANTHROPIC_API_KEY"):
        if not args.no_llm:
            print("[parser] ANTHROPIC_API_KEY not set; skipping LLM step.", file=sys.stderr)
        return

    print(f"[parser] parsing against AO {args.ao}…", flush=True)
    parsed = llm_parser.parse(text, ao, units.snapshot(), args.speaker)
    print(f"[parser] {json.dumps(parsed, indent=2, ensure_ascii=False)}", flush=True)

    print("[ground] resolving location…", flush=True)
    resolved = grounding.ground(parsed, ao, units, args.speaker)
    print(f"[ground] {json.dumps(resolved, indent=2, ensure_ascii=False)}", flush=True)


if __name__ == "__main__":
    main()
