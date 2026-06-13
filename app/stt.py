"""mlx-whisper wrapper. Lazy-load large-v3-turbo on first call."""
from __future__ import annotations
from pathlib import Path

_MODEL_REPO = "mlx-community/whisper-large-v3-turbo"


def transcribe(audio_path: str | Path) -> str:
    """Transcribe an audio file. mlx-whisper uses ffmpeg internally so WAV/WebM/MP4/OGG all work."""
    import mlx_whisper  # lazy: defers ~1s mlx import until first audio arrives
    result = mlx_whisper.transcribe(
        str(audio_path),
        path_or_hf_repo=_MODEL_REPO,
        verbose=False,
        task="transcribe",
    )
    return (result.get("text") or "").strip()
