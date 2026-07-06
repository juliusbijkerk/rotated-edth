# ROTATED — demo video script

A tight **~2-minute** walkthrough for a portfolio / internship showcase. Goal: a
non-technical viewer instantly gets *"you speak, it lands on a live command map,
correctly, and it's real."* Show, don't narrate.

Publish it **unlisted on YouTube**, then paste the video id into `VIDEO_ID` in
`landing/index.html` — it embeds automatically on `rotated.cc`.

---

## Before you record (10 min)

1. **Bring the system online** (your Mac):
   - Tab 1: `cd ~/development/edth_argus && ROTATED_PORT=8010 uv run python -m app`
   - Tab 2: `cloudflared tunnel run rotated`
2. **Operator** open on the Mac: `https://app.rotated.cc/operator` (or `localhost:8010/operator`
   for a cleaner recording with no tunnel latency). Default view = 3D + FUSION, Kyiv AO.
3. **Unit** open on your phone: `https://unit.rotated.cc/unit`. Pick call-sign **ALPHA**.
   (Optional second phone = **BRAVO** for the multi-unit beat.)
4. **Dry-run every line below once** and confirm each grounds where you expect. STT +
   grounding vary run-to-run — lock in the exact phrasings that work *before* you hit record.
5. Quiet room. Screen-record the Mac (QuickTime → File ▸ New Screen Recording, or `⇧⌘5`).
   Ideal: also film the phone (second camera) so the viewer sees the tap-and-speak → map update.

---

## Storyboard (6 beats)

Each beat: **[what you say on the phone]** → *what the viewer sees* → why it matters.

**0:00 — Cold open (5s).** Operator map, dark, Kyiv, 3D buildings. Title card:
`ROTATED · voice → map · EDTH Paris 2026 · 2nd place`.

**0:05 — Beat 1 · a unit arrives.**
> "Alpha, moving to Maidan Nezalezhnosti, over."

*Marker drops on Independence Square; a street-following trail draws in; camera flies to it.*
→ Natural speech, no coordinates, correct place. The hook.

**0:25 — Beat 2 · precision ("west side of…").**
> "Alpha, now holding the west side of the central railway station, over."

*Marker lands offset to the correct side of the station, not its centroid.*
→ This is the differentiator — relative-to-POI grounding. Linger on it.

**0:45 — Beat 3 · enemy contact.**
> "Alpha, contact — two vehicles at the Golden Gate, over."

*A red hostile marker appears at Golden Gate (friendly Alpha does NOT move).*
→ Friendly vs. hostile tracks, from one spoken word ("contact").

**1:05 — Beat 4 · second unit (multi-unit).**  *(skip if solo)*
> "Bravo, moving up Khreshchatyk toward the stadium, over."

*Second friendly marker + its own routed trail; roster shows two live units.*
→ One operator, many units, in parallel.

**1:25 — Beat 5 · the "how".** Cut to a 3-second overlay of the pipeline:
`voice → Whisper (on-device) → Claude tool-use → grounding ladder → OSRM route → map`.
→ Credibility: it's a real pipeline, not a wizard-of-oz.

**1:40 — Beat 6 · close.** Pull back to the full 3D map with all markers + trails.
Caption: `Built in 36h. FastAPI · MapLibre · Claude Sonnet · local Whisper.`
End card: `rotated.cc` + your GitHub.

---

## Backup radio lines (verified-in-your-dry-run only)
- "Alpha, at Saint Sophia Cathedral, over."
- "Bravo, holding 200 metres north of the Olympic Stadium, over."
- "Alpha, contact — dismounts near the Golden Gate metro, over."

## Editing
- **Length:** 90–120s. Cut dead air between "hold PTT" and the map update — but keep
  *one* real-time beat uncut so it's obviously not faked.
- **Captions:** burn in each spoken line as a lower-third — most people watch muted.
- **Resolution:** 1080p, 30fps is plenty. Music optional/low.

## Publish
1. Upload to YouTube, visibility **Unlisted**.
2. Copy the id from the URL (`watch?v=XXXXXXXXXXX` → `XXXXXXXXXXX`).
3. In `landing/index.html`, set `var VIDEO_ID = 'XXXXXXXXXXX';`.
4. Redeploy the landing page (see `DEPLOY.md`). Done — it plays on `rotated.cc`.
