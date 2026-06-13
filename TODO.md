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
