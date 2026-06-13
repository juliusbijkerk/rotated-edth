"""Speech-to-text providers.

Defaults to local mlx-whisper. Set ARGUS_STT_PROVIDER=deepgram to use
Deepgram's pre-recorded audio endpoint for the buffered PTT blobs.
"""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path

_DEFAULT_MODEL_REPO = "mlx-community/whisper-large-v3-turbo"
_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


def transcribe(audio_path: str | Path) -> str:
    """Transcribe an audio file with the configured STT provider."""
    provider = os.environ.get("ARGUS_STT_PROVIDER", "whisper").strip().lower()
    if provider in {"whisper", "mlx", "mlx-whisper", "local"}:
        return _transcribe_whisper(audio_path)
    if provider in {"deepgram", "dg"}:
        return _transcribe_deepgram(audio_path)
    raise ValueError(f"Unknown ARGUS_STT_PROVIDER={provider!r}; use 'whisper' or 'deepgram'.")


def _transcribe_whisper(audio_path: str | Path) -> str:
    """Transcribe an audio file. mlx-whisper uses ffmpeg internally so WAV/WebM/MP4/OGG all work."""
    import mlx_whisper  # lazy: defers ~1s mlx import until first audio arrives
    result = mlx_whisper.transcribe(
        str(audio_path),
        path_or_hf_repo=os.environ.get("ARGUS_WHISPER_MODEL", _DEFAULT_MODEL_REPO),
        verbose=False,
        task="transcribe",
    )
    return (result.get("text") or "").strip()


def _transcribe_deepgram(audio_path: str | Path) -> str:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPGRAM_API_KEY not set; keep it in .env, never in source.")

    path = Path(audio_path)
    params = {
        "model": os.environ.get("DEEPGRAM_MODEL", "nova-3"),
        "smart_format": os.environ.get("DEEPGRAM_SMART_FORMAT", "true"),
    }
    language = os.environ.get("DEEPGRAM_LANGUAGE")
    if language:
        params["language"] = language

    timeout = float(os.environ.get("DEEPGRAM_TIMEOUT_SECONDS", "30"))

    import requests  # already a project dependency; lazy so local STT startup stays unchanged

    with path.open("rb") as f:
        resp = requests.post(
            _DEEPGRAM_URL,
            params=params,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": _content_type(path),
            },
            data=f,
            timeout=timeout,
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"Deepgram STT failed ({resp.status_code}): {resp.text[:500]}")

    payload = resp.json()
    try:
        transcript = payload["results"]["channels"][0]["alternatives"][0]["transcript"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Deepgram response missing transcript: {payload!r}") from exc
    return (transcript or "").strip()


def _content_type(path: Path) -> str:
    if path.suffix.lower() == ".webm":
        return "audio/webm"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
