# Argus · ROTATED

**Push-to-talk situational awareness — from voice to map in seconds.**

Field units carry phones, tap-and-hold, and speak natural-language reports. Argus
transcribes locally with Whisper, parses each report with Claude against the
Area-of-Operations context, grounds the spoken location deterministically, and updates
a live 3D command map with friendly units, enemy contacts, and street-following trails.

🏆 **2nd place / 29 teams** — European Defense Tech Hackathon, Paris 2026 ·
challenge #04 (Voice-to-Map) from Lysk.
🔗 **[rotated.cc](https://rotated.cc)** (live landing) ·
[event](https://luma.com/edth-2026-paris) ·
[recap](https://www.linkedin.com/posts/european-defense-tech_before-everyone-gathered-this-week-at-eurosatory-activity-7472672979731279872-_KB8)

## Pipeline

```
voice → Whisper (on-device) → Claude tool-use → grounding ladder → OSRM route → MapLibre map
```

The LLM never emits raw coordinates — it returns a *structured location reference*, which a
deterministic grounding ladder resolves against the AO's pre-fetched map data.

## Architecture

- **Backend**: Python 3.11+ · FastAPI · WebSockets · in-memory state · HTTP Basic Auth.
- **Operator**: MapLibre GL command map — NATO milsymbol, Overture POIs, extruded 3D
  buildings, enemy contacts, routed trails (`web/ops.html`).
- **Unit**: lightweight push-to-talk web app (vanilla TypeScript · Vite).
- **STT**: local `mlx-whisper` `large-v3-turbo` on Apple Silicon — **no audio leaves the laptop**.
- **Parsing**: Anthropic API · `claude-sonnet-4-6` · forced tool-use for a guaranteed schema.
- **Grounding**: deterministic ladder — OSM POI → relative-to-POI → coordinate → MGRS →
  relative-to-unit → relative-to-self.
- **Routing**: OSRM (street-following trails between fixes).
- **Map data**: Esri World Imagery tiles; POIs pre-fetched once from OSM Overpass and cached
  in-repo (`app/presets/`), **not** called at demo time.
- **Serving**: Cloudflare named tunnel (live app, on-demand) + Cloudflare Pages (always-up landing).

Only the Anthropic API and tile/routing servers are touched at demo time; STT is local.

## Setup

```sh
brew install uv ffmpeg          # system deps (one-time)
uv sync                         # Python deps
npm install                     # frontend deps

cp .env.example .env            # then set ANTHROPIC_API_KEY (and ARGUS_PASS to lock the site)

npm run build                   # build the unit frontend
ARGUS_PORT=8010 uv run python -m app
```

The server prints its LAN IP and QR codes for the operator and unit URLs. The active AO
(Kyiv) ships pre-fetched in `app/presets/`; regenerate or add areas with
`uv run python scripts/fetch_ao_preset.py <ao>`.

## Demo

- Open the **operator URL** on a MacBook.
- Scan the **unit URL** QR with a phone, pick a callsign (Alpha / Bravo / Charlie),
  tap-and-hold to speak (e.g. *"Alpha, at Kyiv central railway station, over"*).
- The marker + routed trail appear on the map within seconds.

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the walkthrough script and
[DEPLOY.md](DEPLOY.md) for the always-up landing-page deployment.

## Credits

Built in ~36 hours by **[Julius Bijkerk](https://github.com/juliusbijkerk)** and
**[Leon van Rooijen](https://github.com/leonvanrooijen)**.

## Status

Hackathon code — **working > elegant**. See `CLAUDE.md` for development guidance.
