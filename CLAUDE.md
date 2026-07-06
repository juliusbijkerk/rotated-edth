# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**ROTATED**: push-to-talk voice-to-map for tactical situational awareness. Built at EDTH Paris 2026 (June 12–14) for challenge #04 (Voice-to-Map) from Lysk. Hackathon code — **working > elegant**, in-place decisions over abstractions.

## Run

```sh
# One-time setup
brew install uv ffmpeg
uv sync
npm install
cp .env.example .env   # then set ANTHROPIC_API_KEY

# AO presets (already committed under app/presets/; re-run only if you want fresh OSM data)
uv run python scripts/fetch_ao_preset.py all --force

# Frontend (re-run after any web/ edit)
npm run build

# Boot — binds 0.0.0.0:8000, prints LAN IP + QR codes for operator and unit URLs
uv run python -m app
```

## Smoke-test the pipeline offline

```sh
say -o /tmp/x.aiff "Alpha is at the Madeleine metro entrance, moving north."
afconvert /tmp/x.aiff -d LEI16@16000 -f WAVE data/audio_samples/test.wav
uv run python scripts/test_pipeline.py data/audio_samples/test.wav --ao paris_8 --speaker Alpha
# add --no-llm to skip the Anthropic step
```

## Hot path

Each PTT release:

```
unit phone (web/src/unit.ts)
  → MediaRecorder blob, binary WS frame
  → /ws/unit/{Alpha|Bravo|Charlie}      (app/server.py)
  → app/stt.py        mlx-whisper large-v3-turbo (lazy-loaded, ffmpeg decodes container)
  → app/parser.py     claude-sonnet-4-6 with tool-use; AO POI list is prompt-cached
  → app/grounding.py  ladder: osm_poi → coordinate → mgrs → relative_to_unit → relative_to_self → unresolved
  → app/units.py      in-memory position history
  → broadcast to /ws/operator
  → web/src/operator.ts updates Leaflet markers, polylines, transcript pane
```

Server state is **in-memory only** (units, reports, current AO). Restart wipes everything — intentional for the hackathon.

## Layout

- `app/` — FastAPI server, STT, parser, grounding, units. `__main__.py` is the entrypoint (`python -m app`).
- `app/presets/{paris_8,pokrovsk}.json` — pre-fetched OSM POI dumps. Overpass is **never** called at demo time.
- `web/` — Vite multi-page (operator.html, unit.html). Vanilla TS, Leaflet, no framework.
- `scripts/fetch_ao_preset.py` — Overpass fetcher (User-Agent set; tries mirrors).
- `scripts/test_pipeline.py` — offline WAV → STT → parser → grounder smoke test.

## Decisions worth knowing

- **Python 3.12, not 3.11.** Spec said 3.11; 3.12 was already installed and every dep supports it.
- **Pokrovsk POIs are Cyrillic.** If a judge says "Mykhailivka" in English the parser will likely route through `relative_to_self` rather than POI match. Adding Latin transliteration aliases is a Phase 2 polish.
- **Audio is buffered then sent on PTT release**, not streamed. One binary WS frame per utterance.
- **Grounding ladder branches fall through to `unresolved`** when their inputs are missing. Don't add try/except around the branches — the fall-through *is* the error handling.
- **Prompt caching** is on the AO POI block (`cache_control: ephemeral` in `app/parser.py`). Hits save tokens when the same AO sees many reports.
- **MGRS and relative-to-unit are wired** (not stubbed) because both fit the same fall-through shape as the other branches — they degrade gracefully when their fields aren't populated.
- **Server doesn't auto-build the frontend.** If `web/dist/operator.html` is missing the /operator route returns a 503 page telling you to `npm run build`.

## Phase status

- Phase 1 (MVP, end-to-end demoable) — **complete**.
- Phase 2 (marker polish, Needs Review, transliteration, stale indicator) — not started.
- Phase 3 (radio quality demo with bandpass/noise) — not started.
- Phase 4 (VLM landmark extraction, live AO drawing) — not started.
