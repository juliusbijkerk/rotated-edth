"""FastAPI app: REST presets + WS unit/operator + static serving."""
from __future__ import annotations
import asyncio
import base64
import json
import os
import secrets
import time
import traceback
from pathlib import Path
from typing import Optional

import anthropic
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import grounding, parser as llm_parser, routing, stt
from .units import UnitRegistry

PROJECT_ROOT = Path(__file__).parent.parent
PRESETS_DIR = PROJECT_ROOT / "app" / "presets"
DIST_DIR = PROJECT_ROOT / "web" / "dist"
TMP_DIR = PROJECT_ROOT / "data" / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="ROTATED")


# ---------- Auth (HTTP Basic, covers HTTP + WebSocket handshakes) ----------
# Set ROTATED_USER / ROTATED_PASS in .env to enable. Leave ROTATED_PASS unset to disable
# (the warning at startup will tell you it's open). Browsers prompt natively and
# cache credentials per-origin, so phones auth once and reuse for WebSocket upgrades.
# Legacy ARGUS_USER / ARGUS_PASS are still accepted so existing .env files keep working.
_AUTH_USER = os.environ.get("ROTATED_USER") or os.environ.get("ARGUS_USER") or "rotated"
_AUTH_PASS = os.environ.get("ROTATED_PASS") or os.environ.get("ARGUS_PASS") or ""


def _check_basic_auth(authorization: str) -> bool:
    """Return True if the Authorization header carries the configured Basic creds.
    Returns True when auth is disabled (no password set)."""
    if not _AUTH_PASS:
        return True
    if not authorization or not authorization.startswith("Basic "):
        return False
    try:
        user, pwd = base64.b64decode(authorization[6:]).decode("utf-8").split(":", 1)
    except Exception:
        return False
    return (
        secrets.compare_digest(user, _AUTH_USER)
        and secrets.compare_digest(pwd, _AUTH_PASS)
    )


@app.middleware("http")
async def _basic_auth_middleware(request: Request, call_next):
    # /api/health is the public, CORS-enabled liveness probe used by the static landing
    # page to decide whether to show ONLINE / OFFLINE. Skip auth for it.
    if request.url.path == "/api/health":
        return await call_next(request)
    if _check_basic_auth(request.headers.get("authorization", "")):
        return await call_next(request)
    return Response(
        content="Unauthorized\n",
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="ROTATED"'},
    )


@app.get("/api/health")
def health():
    """Public, CORS-friendly liveness probe — the landing page calls this to detect ONLINE."""
    return Response(
        content='{"ok":true}',
        media_type="application/json",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
        },
    )

units = UnitRegistry()
reports: list[dict] = []
contacts: list[dict] = []  # observed enemy/contact markers (action=contact reports)
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
    for ao_id in ("kyiv", "pokrovsk", "paris_8"):
        path = PRESETS_DIR / f"{ao_id}.json"
        if path.exists():
            current_ao_id = ao_id
            current_ao = json.loads(path.read_text())
            return


_initial_ao()


# ----- REST -----

@app.post("/api/reset")
def reset_state():
    """Wipe in-memory units/reports/contacts so the operator gets a clean slate
    (useful between demo runs without needing to restart the server)."""
    global reports, contacts
    units.__init__()  # rebuild empty registry
    reports.clear()
    contacts.clear()
    return {"ok": True}


@app.get("/api/bridges")
def get_bridges():
    """Named bridges for the current AO as GeoJSON (with real line/polygon geometry).
    Falls back to an empty FeatureCollection if no bridge file exists for the AO."""
    if current_ao_id:
        path = PRESETS_DIR / f"{current_ao_id}_bridges.geojson"
        if path.exists():
            return json.loads(path.read_text())
    return {"type": "FeatureCollection", "features": []}


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
    return items


@app.get("/api/presets/{ao_id}")
def get_preset(ao_id: str):
    return _load_preset(ao_id)


# ----- Static + page routes -----

@app.get("/")
def root():
    return RedirectResponse(url="/operator")


def _missing_dist_html(page: str) -> str:
    return (
        f"<!doctype html><html><body style='font-family:sans-serif;background:#0c1115;color:#e6edf2;padding:40px'>"
        f"<h1>ROTATED</h1>"
        f"<p>The frontend bundle is missing. Build it first:</p>"
        f"<pre>npm install\nnpm run build</pre>"
        f"<p>Then refresh this page.</p>"
        f"<p style='color:#8aa1b1'>(page requested: <code>{page}</code>)</p>"
        f"</body></html>"
    )


@app.get("/operator")
def serve_operator():
    ops = PROJECT_ROOT / "web" / "ops.html"
    if ops.exists():
        return FileResponse(ops)  # standalone MapLibre C2 operator (this branch)
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
        "reports": reports[-50:],
        "contacts": contacts[-50:],
    }


# ----- WebSocket: operator -----

@app.websocket("/ws/operator")
async def ws_operator(ws: WebSocket):
    global current_ao_id, current_ao
    if not _check_basic_auth(ws.headers.get("authorization", "")):
        await ws.close(code=4401)  # custom code = auth failed
        return
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
    except WebSocketDisconnect:
        pass
    finally:
        operator_sockets.discard(ws)


# ----- WebSocket: unit (audio in) -----

@app.websocket("/ws/unit/{unit_id}")
async def ws_unit(ws: WebSocket, unit_id: str):
    if not _check_basic_auth(ws.headers.get("authorization", "")):
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        while True:
            frame = await ws.receive()
            if frame.get("type") == "websocket.disconnect":
                break
            data = frame.get("bytes")
            if data:
                await _handle_utterance(ws, unit_id, data)
                continue
            text = frame.get("text")
            if not text:
                continue
            try:
                msg = json.loads(text)
            except Exception:
                continue
            if msg.get("type") == "text_report":
                await _handle_text(ws, unit_id, msg.get("transcript", ""))
            # other text frames (e.g. audio_meta) are advisory — ignored
    except WebSocketDisconnect:
        pass


async def _handle_utterance(ws: WebSocket, unit_id: str, audio_bytes: bytes) -> None:
    ts = int(time.time() * 1000)
    path = TMP_DIR / f"{unit_id}-{ts}.webm"  # ffmpeg detects container regardless of ext
    path.write_bytes(audio_bytes)
    await _send(ws, {"type": "progress", "stage": "received"})

    try:
        transcript = await asyncio.to_thread(stt.transcribe, path)
    except Exception as e:
        traceback.print_exc()
        await _send(ws, {"type": "error", "stage": "stt", "error": str(e)})
        return

    await _process(ws, unit_id, transcript, ts)


async def _handle_text(ws: WebSocket, unit_id: str, transcript: str) -> None:
    """Typed-report fallback (when the phone mic is blocked) — same pipeline, minus STT."""
    if not transcript.strip():
        return
    await _process(ws, unit_id, transcript.strip(), int(time.time() * 1000))


async def _process(ws: WebSocket, unit_id: str, transcript: str, ts: int) -> None:
    await _send(ws, {"type": "progress", "stage": "transcribed", "transcript": transcript})
    if current_ao is None:
        await _send(ws, {"type": "error", "stage": "ao", "error": "no AO loaded — pick one in the operator dashboard"})
        return

    await _send(ws, {"type": "progress", "stage": "understanding"})
    try:
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

    await _send(ws, {"type": "progress", "stage": "locating"})
    try:
        resolved = grounding.ground(parsed, current_ao, units, unit_id)
    except Exception as e:
        traceback.print_exc()
        await _send(ws, {"type": "error", "stage": "ground", "error": str(e)})
        return

    route = None
    action = (parsed.get("action") or "").lower()
    # Place every report — even unresolved ones — at the best-guess location (AO center
    # fallback) so the operator sees *something* land instead of silent dead-ends. The
    # grounder still flags needs_review on the report so review tooling can pick it up later.
    if action == "contact":
        # An observed enemy/contact at a location -> drop a hostile marker there; do NOT
        # move the reporting unit (we don't know it moved to where it sees the contact).
        contacts.append({
            "id": ts, "unit": unit_id,
            "lat": resolved["lat"], "lon": resolved["lon"],
            "observed": parsed.get("observed", ""), "transcript": transcript,
            "timestamp": time.time(),
        })
    else:
        prev = units.last_position(unit_id)
        if prev:
            # Snap the leg from the unit's last fix to roads so the trail follows streets,
            # not a straight line over buildings. Best-effort — falls back to a straight line.
            await _send(ws, {"type": "progress", "stage": "routing"})
            route = await asyncio.to_thread(
                routing.route, prev["lat"], prev["lon"], resolved["lat"], resolved["lon"],
            )
        units.append_position(unit_id, resolved["lat"], resolved["lon"], ts=time.time(), route=route)
    units.set_last_report(unit_id, transcript)

    report = {
        "id": ts,
        "unit": unit_id,
        "transcript": transcript,
        "parsed": parsed,
        "resolved": resolved,
        "timestamp": time.time(),
    }
    reports.append(report)
    await _send(ws, {"type": "report_echo", "report": report})
    await broadcast({"type": "report", "report": report, "units": units.snapshot(), "contacts": contacts[-50:]})


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload, default=str))
    except Exception:
        pass
