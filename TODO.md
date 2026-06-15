# Argus — backlog / parked ideas

Get the first working demo solid; these are deliberately deferred.

## Product / UX
- **Operations dashboard (home page):** list past operations + currently-live
  missions; click one to open. Requires **persistence** (state is in-memory today,
  wiped on restart) — a real datastore for operations/reports. Bigger step.
- **Reset / "new operation" control** on the operator: clear units + reports
  without restarting the server (WS message → server clears state). Quick win;
  today the reset is "restart the server".
- **Marker prominence:** pulsing ring on the active/latest unit marker so it
  stands out among POI labels. (Auto-pan already lands it centred.)
- Stale-unit gray-out after N minutes of no report.

## Capability
- **Movement plan + status:** parser actions `movement_plan` (destination ref →
  dashed projected path to a ghost marker) and `status_update` (state + dwell/ETA
  on the unit card). Fits the existing tool schema.
- **Contact-icon overlay** for `action=contact` reports (Bravo's beat).
- **Geocoder fallback** (e.g. Nominatim) as a bottom rung of the grounding ladder
  to resolve spoken place names not in the pre-fetched POI table — reduces the
  "pre-fetch every area" burden. Network at demo time; respect rate limits.
- **Runtime AO drawing:** drag a rectangle → live Overpass fetch → load. Clamp/warn
  on box size (too big = slow fetch + 200-cap drops features; too small = nothing).
- Radio-quality demo: bandpass + noise on the audio, ▶ play buttons per transcript
  card, side-by-side WER.
- VLM landmark extraction: capture the map view, ask Claude vision for distinctive
  features, geo-reference + add to POIs.

## Ops
- Named cloudflared tunnel (stable URL) instead of the quick tunnel, if wanted.
- QR for the tunnel URL so phones scan instead of type.

## From live testing (Jun 13)
- **Live pipeline feedback** (DONE): unit shows received → understanding → placing → placed.
- **WS auto-reconnect:** operator/unit sockets don't recover from a dropped connection
  (tunnel blips) — add exponential-backoff reconnect in `web/src/ws.ts`. Top robustness fix.
- **Operator-defined AOs:** draw a box (or type a place name) → live Overpass fetch at runtime,
  instead of the fixed presets. Clamp box size. (Supersedes the curated preset list.)
- **Street-following trails:** snap the trail between fixes to roads via a routing engine
  (OSRM / Valhalla / GraphHopper) instead of straight lines over buildings.
- **More precise POIs:** big features ("Hoog Catharijne" mall) ground to a vague centroid.
  Use entrance nodes / addresses / a richer dataset (Overture Maps, OSM entrances) for
  point-precise, better-described locations — also improves text→POI matching.

## From demo prep (Jun 14)
- **Operator-side review queue:** today `needs_review` reports place at AO-center but
  there's no UI to triage/correct them. Build a "Needs Review" panel on the operator
  with the original transcript and a click-to-place-on-map control. Then re-enable the
  needs_review gate so unresolved reports don't junk the map silently.
- **Inline focus-on-place search** on the operator (Google-Maps style): geocode a
  typed place / "lat,lon" / use-my-location → flyTo. Previous attempt was reverted
  because the welcome-overlay regex cut too many </div>s and broke the page; redo
  with the Edit tool instead of a regex pass.

## After 2nd-place demo (Jun 15)
- **Addresses (street + house number) as POIs:** ground "92 Khreshchatyk" precisely.
  Pull from OSM `addr:housenumber`+`addr:street` (Overpass) or use Nominatim reverse-
  geocoding at runtime. Must be rock-solid — addresses are the simplest, highest-
  value precision win.
- **Chat-like conversation panel** (per-unit or single channel): every transcript
  in a collapsible chat sub-interface so the operator can scroll history and "talk
  back" — already half-built (each report has transcript + parsed + resolved).
  Hide by default, expand on click of the unit row. Server already broadcasts the
  full report payload; just needs operator-side UI.
- **Persistent memory** (transcripts, positions, routes, contacts) — switch from
  the in-memory dicts to SQLite (or a JSON file) per session, so a server restart
  doesn't wipe a debrief. Pairs with the Operations dashboard idea (already in TODO).
- **Pedestrian routing:** today we use the OSRM **driving** profile, which obeys
  one-ways and avoids pedestrian streets — so trails take long detours. Switch to
  a foot profile (OpenRouteService, GraphHopper, or a self-hosted OSRM foot.lua).
  Wartime context = ignore traffic direction, take shortest passable path.
