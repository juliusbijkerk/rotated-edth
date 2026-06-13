# Argus

**Push-to-talk situational awareness. From voice to map in seconds, anywhere on earth.**

Field units carry phones, tap push-to-talk, speak natural-language reports. Argus transcribes locally with Whisper, parses with an LLM against the Area of Operations context, grounds the location, and updates a live tactical map with markers, trails, and observations.

Built at the **European Defense Tech Hackathon Paris 2026** for challenge #04 (Voice-to-Map) from Lysk.

## Architecture

- **Backend**: Python 3.11+ · FastAPI · WebSockets · in-memory state.
- **Frontend**: vanilla TypeScript · Vite · Leaflet.
- **STT**: `mlx-whisper` with `large-v3-turbo` (Apple Silicon native). Fallback: `faster-whisper`.
- **Parsing**: Anthropic API · `claude-sonnet-4-6` · tool-use for guaranteed schema.
- **Map tiles**: Esri World Imagery (satellite, no API key) primary, with the AO's pre-fetched OSM POIs overlaid as labelled markers.
- **OSM data**: Overpass API for AO preset generation (run **once at setup**, cached as JSON in repo). **Not** called at demo time.

Only Anthropic API and tile servers are touched at demo time. STT runs locally on the Mac.

## Setup

```sh
# 1. Install system deps (one-time)
brew install uv ffmpeg

# 2. Python venv + deps
uv sync

# 3. Frontend deps
npm install

# 4. Configure
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY

# 5. Pre-fetch AO presets (only if you don't trust the committed JSONs)
uv run python scripts/fetch_ao_preset.py paris_8
uv run python scripts/fetch_ao_preset.py pokrovsk

# 6. Build frontend
npm run build

# 7. Run
uv run python -m app
```

The server prints its local IP and QR codes for the operator and unit URLs.

## Demo

- Open **operator URL** on a MacBook (Wi-Fi connected to the same LAN).
- Pick an AO from the dropdown (Paris 8th or Pokrovsk).
- Scan **unit URL** QR with a phone. Pick a callsign (Alpha / Bravo / Charlie). Tap-and-hold to speak.
- Marker on the map updates within seconds.

## Status

This is hackathon code. Working > elegant. See `CLAUDE.md` for development guidance.
