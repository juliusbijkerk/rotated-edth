"""In-memory unit registry: callsign → position history."""
from __future__ import annotations
import threading
import time
from typing import Optional

UNIT_IDS = ["Alpha", "Bravo", "Charlie"]


class UnitRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._units: dict[str, dict] = {
            uid: {"id": uid, "positions": [], "last_report": None}
            for uid in UNIT_IDS
        }

    def append_position(self, unit_id: str, lat: float, lon: float,
                        heading_deg: Optional[float] = None,
                        ts: Optional[float] = None) -> None:
        with self._lock:
            if unit_id not in self._units:
                self._units[unit_id] = {"id": unit_id, "positions": [], "last_report": None}
            self._units[unit_id]["positions"].append({
                "ts": ts or time.time(),
                "lat": lat,
                "lon": lon,
                "heading": heading_deg,
            })

    def set_last_report(self, unit_id: str, text: str) -> None:
        with self._lock:
            if unit_id in self._units:
                self._units[unit_id]["last_report"] = text

    def last_position(self, unit_id: str) -> Optional[dict]:
        with self._lock:
            u = self._units.get(unit_id)
            if not u or not u["positions"]:
                return None
            return dict(u["positions"][-1])

    def snapshot(self) -> dict:
        with self._lock:
            return {
                uid: {
                    "id": uid,
                    "positions": list(u["positions"]),
                    "last_position": dict(u["positions"][-1]) if u["positions"] else None,
                    "last_report": u["last_report"],
                }
                for uid, u in self._units.items()
            }
