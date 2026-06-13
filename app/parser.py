"""Anthropic tool-use parser: transcript → ParsedReport."""
from __future__ import annotations
import os
from typing import Optional

import anthropic

_MODEL = "claude-sonnet-4-6"

_TOOL = {
    "name": "report_parsed",
    "description": "Emit the parsed structured report from the operator's spoken transcript.",
    "input_schema": {
        "type": "object",
        "properties": {
            "entity": {
                "type": "string",
                "description": "Unit callsign making the report (Alpha/Bravo/Charlie), or 'unknown'.",
            },
            "action": {
                "type": "string",
                "enum": ["position_update", "observation", "contact", "request", "other"],
                "description": "Type of report.",
            },
            "location_reference": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["osm_poi", "coordinate", "mgrs",
                                 "relative_to_unit", "relative_to_self", "unresolved"],
                    },
                    "raw_text": {"type": "string", "description": "Exact phrase from transcript that referenced the location."},
                    "poi_name": {"type": "string", "description": "Named feature from AO POI list (use the canonical name)."},
                    "coordinates": {"type": "array", "items": {"type": "number"},
                                    "description": "[lon, lat] decimal degrees (only if type=coordinate)."},
                    "mgrs": {"type": "string", "description": "MGRS grid reference (only if type=mgrs)."},
                    "reference_unit": {"type": "string", "description": "Other unit callsign (only if type=relative_to_unit)."},
                    "bearing_deg": {"type": "number", "description": "Bearing degrees clockwise from north (0–360)."},
                    "distance_m": {"type": "number", "description": "Distance in meters from reference point."},
                },
                "required": ["type", "raw_text"],
            },
            "observed": {"type": "string", "description": "What the unit reports observing (e.g. 'two figures'). Empty string if none."},
            "confidence": {"type": "number", "description": "0.0–1.0 confidence in your interpretation."},
        },
        "required": ["entity", "action", "location_reference", "confidence"],
    },
}


def _system_blocks(ao: dict) -> list:
    # Truncate the POI list for prompt size; favor first 200 (Overpass returns them roughly bbox-ordered).
    pois = ao.get("pois", [])[:200]
    poi_text = "\n".join(
        f"- {p['name']} ({p['type']}) [{p['coords'][1]:.5f},{p['coords'][0]:.5f}]"
        + (f" aka {', '.join(p['aliases'])}" if p.get("aliases") else "")
        for p in pois
    )
    intro = (
        "You parse push-to-talk field reports for a tactical situational-awareness system. "
        "Call the `report_parsed` tool with the structured interpretation.\n\n"
        "Pick the most specific location_reference.type:\n"
        "- osm_poi: transcript references a named feature in the POI list (use the canonical poi_name).\n"
        "- coordinate: decimal lat/lon in the transcript.\n"
        "- mgrs: MGRS grid reference.\n"
        '- relative_to_unit: relative to another callsign ("300 meters east of Bravo").\n'
        '- relative_to_self: relative to the speaker ("moving north 200 meters").\n'
        "- unresolved: cannot determine.\n\n"
        "For relative references, set bearing_deg (0=N, 90=E, 180=S, 270=W) and distance_m. "
        "Default entity to the speaker unless the transcript clearly attributes the report to another unit."
    )
    ao_block = (
        f"AREA OF OPERATIONS: {ao['name']} ({ao.get('type', '?')})\n"
        f"Center: {ao['center'][1]:.5f}, {ao['center'][0]:.5f}\n\n"
        f"KNOWN POIs:\n{poi_text or '(none)'}"
    )
    return [
        {"type": "text", "text": intro},
        # AO block is large + reused across many calls in the same AO; cache it.
        {"type": "text", "text": ao_block, "cache_control": {"type": "ephemeral"}},
    ]


def _user_message(transcript: str, units_state: dict, speaker: str) -> str:
    lines = []
    for uid, u in units_state.items():
        lp = u.get("last_position")
        if lp:
            line = f"- {uid}: {lp['lat']:.5f},{lp['lon']:.5f}"
            if lp.get("heading") is not None:
                line += f" heading {lp['heading']:.0f}°"
            lines.append(line)
        else:
            lines.append(f"- {uid}: no position yet")
    return (
        "UNITS:\n" + "\n".join(lines) + "\n\n"
        f"SPEAKER: {speaker}\n"
        f'TRANSCRIPT: "{transcript}"'
    )


def parse(transcript: str, ao: dict, units_state: dict, speaker: str,
          client: Optional[anthropic.Anthropic] = None) -> dict:
    """Send transcript + AO + units to Claude with forced tool-use. Returns the parsed dict."""
    if not transcript.strip():
        return _empty(speaker)
    if client is None:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    resp = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_system_blocks(ao),
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "report_parsed"},
        messages=[{"role": "user", "content": _user_message(transcript, units_state, speaker)}],
    )
    for block in resp.content:
        if block.type == "tool_use" and block.name == "report_parsed":
            return dict(block.input)
    return _empty(speaker, transcript)


def _empty(speaker: str, raw: str = "") -> dict:
    return {
        "entity": speaker,
        "action": "other",
        "location_reference": {"type": "unresolved", "raw_text": raw},
        "observed": "",
        "confidence": 0.0,
    }
