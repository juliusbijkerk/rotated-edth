"""FastAPI app: REST presets + WS unit/operator + static serving."""
from __future__ import annotations
import asyncio
import json
import os
import time
import traceback
from pathlib import Path
from typing import Optional

import anthropic
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import grounding, parser as llm_parser, stt
from .units import UnitRegistry

PROJECT_ROOT = Path(__file__).parent.parent
PRESETS_DIR = PROJECT_ROOT / "app" / "presets"
DIST_DIR = PROJECT_ROOT / "web" / "dist"
TMP_DIR = PROJECT_ROOT / "data" / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Argus")

units = UnitRegistry()
reports: list[dict] = []
targets: list[dict] = []
current_ao_id: Optional[str] = None
current_ao: Optional[dict] = None
operator_sockets: set[WebSocket] = set()
_anthropic_client: Optional[anthropic.Anthropic] = None


def _get_anthropic() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set; copy .env.example to .env.")
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


def _load_preset(ao_id: str) -> dict:
    path = PRESETS_DIR / f"{ao_id}.json"
    if not path.exists():
        raise HTTPException(404, f"Unknown AO preset: {ao_id}")
    return json.loads(path.read_text())


def _initial_ao() -> None:
    global current_ao_id, current_ao
    for ao_id in ("paris_central_demo", "paris_8", "pokrovsk"):
        path = PRESETS_DIR / f"{ao_id}.json"
        if path.exists():
            current_ao_id = ao_id
            current_ao = json.loads(path.read_text())
            return


_initial_ao()


# ----- REST -----

@app.get("/api/presets")
def list_presets():
    items = []
    for p in sorted(PRESETS_DIR.glob("*.json")):
        data = json.loads(p.read_text())
        items.append({
            "id": data["id"],
            "name": data["name"],
            "type": data.get("type"),
            "center": data["center"],
            "zoom": data.get("zoom", 14),
            "poi_count": len(data.get("pois", [])),
        })
    if current_ao_id:
        items.sort(key=lambda item: (item["id"] != current_ao_id, item["name"]))
    return items


@app.get("/api/presets/{ao_id}")
def get_preset(ao_id: str):
    return _load_preset(ao_id)


@app.get("/api/state")
def get_state():
    return _state_message()


# ----- Static + page routes -----

@app.get("/")
def root():
    return HTMLResponse(
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Argus</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0b1115; color: #e6edf2;
      font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    }
    main { width: min(520px, calc(100vw - 32px)); }
    h1 { margin: 0 0 10px; font-size: 42px; letter-spacing: 0; }
    p { margin: 0 0 22px; color: #91a3b0; line-height: 1.45; }
    .choices { display: grid; gap: 12px; }
    a {
      display: block; text-decoration: none; color: #e6edf2;
      background: #142029; border: 1px solid #2f4554; border-radius: 8px;
      padding: 18px;
    }
    strong { display: block; font-size: 20px; margin-bottom: 5px; }
    span { color: #9fb2c0; }
  </style>
</head>
<body>
  <main>
    <h1>ARGUS</h1>
    <p>Select the role for this device. Operators monitor and edit the map; units send field reports.</p>
    <div class="choices">
      <a href="/operator"><strong>Operator</strong><span>Laptop or command post map</span></a>
      <a href="/unit"><strong>Unit</strong><span>Phone push-to-talk or typed field reports</span></a>
    </div>
  </main>
</body>
</html>"""
    )


def _missing_dist_html(page: str) -> str:
    return (
        f"<!doctype html><html><body style='font-family:sans-serif;background:#0c1115;color:#e6edf2;padding:40px'>"
        f"<h1>Argus</h1>"
        f"<p>The frontend bundle is missing. Build it first:</p>"
        f"<pre>npm install\nnpm run build</pre>"
        f"<p>Then refresh this page.</p>"
        f"<p style='color:#8aa1b1'>(page requested: <code>{page}</code>)</p>"
        f"</body></html>"
    )


@app.get("/operator")
def serve_operator():
    path = DIST_DIR / "operator.html"
    if not path.exists():
        return HTMLResponse(_missing_dist_html("operator"), status_code=503)
    return FileResponse(path)


@app.get("/unit")
def serve_unit():
    path = DIST_DIR / "unit.html"
    if not path.exists():
        return HTMLResponse(_missing_dist_html("unit"), status_code=503)
    return FileResponse(path)


# Mount asset bundle if vite has built; safe to skip otherwise.
if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


# ----- Broadcast helpers -----

async def broadcast(message: dict) -> None:
    dead = []
    payload = json.dumps(message, default=str)
    for ws in list(operator_sockets):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        operator_sockets.discard(ws)


def _state_message() -> dict:
    return {
        "type": "state",
        "ao_id": current_ao_id,
        "units": units.snapshot(),
        "targets": targets[-100:],
        "reports": reports[-50:],
    }


# ----- WebSocket: operator -----

@app.websocket("/ws/operator")
async def ws_operator(ws: WebSocket):
    global current_ao_id, current_ao
    await ws.accept()
    operator_sockets.add(ws)
    try:
        await ws.send_text(json.dumps(_state_message(), default=str))
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue
            if msg.get("type") == "set_ao":
                ao_id = msg.get("ao_id")
                if ao_id:
                    try:
                        current_ao = _load_preset(ao_id)
                        current_ao_id = ao_id
                        await broadcast({"type": "ao_changed", "ao_id": ao_id})
                    except HTTPException as e:
                        await ws.send_text(json.dumps({"type": "error", "stage": "ao", "error": e.detail}))
            elif msg.get("type") == "set_unit_position":
                unit_id = msg.get("unit_id")
                lat = msg.get("lat")
                lon = msg.get("lon")
                if unit_id and lat is not None and lon is not None:
                    units.append_position(str(unit_id), float(lat), float(lon), ts=time.time())
                    await broadcast({"type": "units", "units": units.snapshot()})
            elif msg.get("type") == "manual_target":
                target = _manual_target(msg)
                if target:
                    targets.append(target)
                    await broadcast({"type": "target", "target": target, "targets": targets[-100:]})
            elif msg.get("type") == "review_report":
                result = _review_report(msg)
                if result.get("error"):
                    await ws.send_text(json.dumps({"type": "error", "stage": "review", "error": result["error"]}))
                else:
                    await broadcast({
                        "type": "report_reviewed",
                        "report": result["report"],
                        "units": units.snapshot(),
                        "targets": targets[-100:],
                    })
    except WebSocketDisconnect:
        pass
    finally:
        operator_sockets.discard(ws)


# ----- WebSocket: unit (audio in) -----

@app.websocket("/ws/unit/{unit_id}")
async def ws_unit(ws: WebSocket, unit_id: str):
    await ws.accept()
    audio_mime_type: Optional[str] = None
    try:
        while True:
            frame = await ws.receive()
            if frame.get("type") == "websocket.disconnect":
                break
            data = frame.get("bytes")
            if data:
                await _handle_utterance(ws, unit_id, data, audio_mime_type)
                audio_mime_type = None
                continue
            text = frame.get("text")
            if text:
                audio_mime_type = await _handle_unit_text(ws, unit_id, text, audio_mime_type)
    except WebSocketDisconnect:
        pass


async def _handle_utterance(ws: WebSocket, unit_id: str, audio_bytes: bytes,
                            mime_type: Optional[str] = None) -> None:
    ts = int(time.time() * 1000)
    if len(audio_bytes) < 1024:
        await _send(ws, {
            "type": "error",
            "stage": "audio",
            "error": "no usable audio captured; hold push-to-talk longer or use typed report",
        })
        return

    path = TMP_DIR / f"{unit_id}-{ts}{_audio_suffix(mime_type)}"
    path.write_bytes(audio_bytes)

    try:
        await _send(ws, {"type": "status", "stage": "stt", "message": "transcribing audio"})
        transcript = await asyncio.to_thread(stt.transcribe, path)
    except Exception as e:
        traceback.print_exc()
        await _send(ws, {"type": "error", "stage": "stt", "error": str(e)})
        return

    await _handle_transcript(ws, unit_id, transcript, ts)


async def _handle_unit_text(ws: WebSocket, unit_id: str, text: str,
                            audio_mime_type: Optional[str]) -> Optional[str]:
    try:
        msg = json.loads(text)
    except Exception:
        msg = {"type": "text_report", "transcript": text}
    if msg.get("type") == "audio_meta":
        return msg.get("mime_type") or audio_mime_type
    if msg.get("type") != "text_report":
        return audio_mime_type
    transcript = (msg.get("transcript") or "").strip()
    if not transcript:
        await _send(ws, {"type": "error", "stage": "input", "error": "empty report"})
        return audio_mime_type
    await _handle_transcript(ws, unit_id, transcript, int(time.time() * 1000))
    return audio_mime_type


async def _handle_transcript(ws: WebSocket, unit_id: str, transcript: str, ts: int) -> None:
    if current_ao is None:
        await _send(ws, {"type": "error", "stage": "ao", "error": "no AO loaded — pick one in the operator dashboard"})
        return

    try:
        await _send(ws, {"type": "status", "stage": "parse", "message": "parsing report"})
        parsed = await asyncio.to_thread(
            llm_parser.parse,
            transcript,
            current_ao,
            units.snapshot(),
            unit_id,
            _get_anthropic(),
        )
    except Exception as e:
        traceback.print_exc()
        await _send(ws, {"type": "error", "stage": "parse", "error": str(e)})
        return

    try:
        await _send(ws, {"type": "status", "stage": "ground", "message": "resolving location"})
        resolved = grounding.ground(parsed, current_ao, units, unit_id)
    except Exception as e:
        traceback.print_exc()
        await _send(ws, {"type": "error", "stage": "ground", "error": str(e)})
        return

    report_needs_review = _needs_review(parsed, resolved)
    if report_needs_review:
        resolved["needs_review"] = True

    action = parsed.get("action")
    if action == "position_update" and not report_needs_review:
        units.append_position(unit_id, resolved["lat"], resolved["lon"], ts=time.time())
    units.set_last_report(unit_id, transcript)

    report = {
        "id": ts,
        "unit": unit_id,
        "transcript": transcript,
        "parsed": parsed,
        "resolved": resolved,
        "timestamp": time.time(),
    }
    target = _target_from_report(report)
    if target:
        targets.append(target)
        report["target"] = target
    reports.append(report)
    await _send(ws, {"type": "report_echo", "report": report})
    await broadcast({
        "type": "report",
        "report": report,
        "units": units.snapshot(),
        "targets": targets[-100:],
    })


def _target_from_report(report: dict) -> Optional[dict]:
    parsed = report.get("parsed") or {}
    action = parsed.get("action")
    if action not in {"observation", "contact"}:
        return None
    resolved = report.get("resolved") or {}
    if "lat" not in resolved or "lon" not in resolved:
        return None
    if resolved.get("method") == "unresolved":
        return None
    raw_target = parsed.get("target") or {}
    observed = parsed.get("observed") or ""
    affiliation = (raw_target.get("affiliation") or ("hostile" if action == "contact" else "unknown")).lower()
    if affiliation not in {"friendly", "hostile", "neutral", "unknown"}:
        affiliation = "unknown"
    entity_type = (raw_target.get("entity_type") or _entity_from_text(observed) or "unknown").lower()
    echelon = (raw_target.get("echelon") or "unknown").lower()
    label = raw_target.get("label") or observed or entity_type
    return {
        "id": f"t-{report['id']}",
        "report_id": report["id"],
        "source_unit": report["unit"],
        "lat": resolved["lat"],
        "lon": resolved["lon"],
        "affiliation": affiliation,
        "entity_type": entity_type,
        "count": raw_target.get("count"),
        "echelon": echelon,
        "label": label,
        "description": observed,
        "confidence": parsed.get("confidence", 0.0),
        "needs_review": bool(resolved.get("needs_review")) or float(parsed.get("confidence", 0.0) or 0.0) < 0.7,
        "timestamp": report["timestamp"],
    }


def _find_report(report_id: object) -> Optional[dict]:
    rid = str(report_id)
    for report in reports:
        if str(report.get("id")) == rid:
            return report
    return None


def _target_for_report(report: dict) -> Optional[dict]:
    rid = str(report.get("id"))
    for target in targets:
        if str(target.get("report_id")) == rid:
            return target
    return None


def _review_report(msg: dict) -> dict:
    report = _find_report(msg.get("report_id"))
    if not report:
        return {"error": "report not found"}
    action = msg.get("action")
    resolved = report.get("resolved") or {}
    report["reviewed_at"] = time.time()

    if action == "accept_position":
        if resolved.get("method") == "unresolved" or "lat" not in resolved or "lon" not in resolved:
            return {"error": "report has no resolved position to accept"}
        units.append_position(report["unit"], float(resolved["lat"]), float(resolved["lon"]), ts=time.time())
        resolved["needs_review"] = False
        report["resolved"] = resolved
        report["review_status"] = "accepted_position"
        return {"report": report}

    if action == "accept_target":
        target = _target_for_report(report)
        if not target:
            target = _target_from_report(report)
            if not target:
                return {"error": "report has no target to accept"}
            targets.append(target)
            report["target"] = target
        target["needs_review"] = False
        resolved["needs_review"] = False
        report["resolved"] = resolved
        report["target"] = target
        report["review_status"] = "accepted_target"
        return {"report": report}

    if action == "reject":
        report["review_status"] = "rejected"
        targets[:] = [t for t in targets if str(t.get("report_id")) != str(report.get("id"))]
        report.pop("target", None)
        return {"report": report}

    return {"error": "unknown review action"}


def _needs_review(parsed: dict, resolved: dict) -> bool:
    try:
        confidence = float(parsed.get("confidence", 0.0) or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    return bool(resolved.get("needs_review")) or confidence < 0.7


def _manual_target(msg: dict) -> Optional[dict]:
    lat = msg.get("lat")
    lon = msg.get("lon")
    if lat is None or lon is None:
        return None
    ts = int(time.time() * 1000)
    affiliation = (msg.get("affiliation") or "unknown").lower()
    if affiliation not in {"friendly", "hostile", "neutral", "unknown"}:
        affiliation = "unknown"
    return {
        "id": f"manual-{ts}",
        "source_unit": "operator",
        "lat": float(lat),
        "lon": float(lon),
        "affiliation": affiliation,
        "entity_type": (msg.get("entity_type") or "unknown").lower(),
        "count": msg.get("count"),
        "echelon": (msg.get("echelon") or "unknown").lower(),
        "label": msg.get("label") or msg.get("entity_type") or "Manual target",
        "description": msg.get("description") or "",
        "confidence": 1.0,
        "needs_review": False,
        "timestamp": time.time(),
    }


def _entity_from_text(text: str) -> str:
    lower = text.lower()
    for word in ("tank", "drone", "vehicle", "infantry", "person", "group"):
        if word in lower:
            return word
    return "unknown"


def _audio_suffix(mime_type: Optional[str]) -> str:
    if not mime_type:
        return ".webm"
    base = mime_type.split(";", 1)[0].strip().lower()
    if base in {"audio/mp4", "audio/aac", "audio/x-m4a"}:
        return ".m4a"
    if base in {"audio/ogg", "application/ogg"}:
        return ".ogg"
    if base in {"audio/wav", "audio/x-wav"}:
        return ".wav"
    return ".webm"


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload, default=str))
    except Exception:
        pass
