# Roadmap

Work deferred beyond the hackathon build, grouped by theme.

## Precision & grounding
- **Addresses as POIs** — ground "92 Khreshchatyk" precisely via OSM `addr:*` tags or
  reverse geocoding.
- **Geocoder fallback** — resolve spoken place names outside the pre-fetched table
  (e.g. Nominatim) as a bottom rung of the grounding ladder.
- **Runtime AO drawing** — draw a box → live Overpass fetch → load, instead of fixed presets.
- **Pedestrian routing** — swap the OSRM driving profile for a foot profile so trails take
  the shortest passable path rather than long one-way detours.

## Operator UX
- **Operations dashboard** — list past and live missions; requires persistence.
- **Conversation panel** — per-unit transcript history the operator can scroll and reply to.
- **Review queue** — triage and correct low-confidence reports before they hit the map.
- **Inline place search** — geocode a typed place / `lat,lon` and fly to it.
- Marker prominence (pulsing active unit) and stale-unit gray-out.

## Capability & robustness
- **Movement plans & status** — projected path to a ghost marker plus unit state / ETA.
- **Persistent state** — move in-memory state to SQLite so a restart doesn't wipe a debrief.
- **WebSocket auto-reconnect** — recover operator/unit sockets after a dropped connection.
- Radio-quality audio simulation; VLM landmark extraction from the map view.
