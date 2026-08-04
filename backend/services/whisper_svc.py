"""
whisper_svc.py — Local Whisper voice transcription service for Passive Second Brain.

Provides:
  transcribe(audio_path)                    — run whisper.cpp locally, return transcript text
  transcribe_and_queue(audio_path, domain)  — transcribe + enqueue as CaptureItem

Design spec: Layer 2 Services — whisper_svc.py
Requirements:
  FR-04 (voice capture)
  4.2  — local whisper.cpp via subprocess (no cloud API)
  4.3  — no external network calls whatsoever
  4.5  — preserve original audio file on any failure
"""

import json
import logging
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.models.schemas import CaptureItem, CaptureStatus, SourceType

logger = logging.getLogger(__name__)

# Maximum time (seconds) to wait for whisper.cpp to finish (Requirement 4.2 — 30 min cap)
_WHISPER_TIMEOUT = 1800

# Directory where audio files are stored (caller is responsible for placing files here)
_VOICE_DIR = Path("data") / "voice"

# Directory where capture items are persisted (Requirement 4.3 — local only)
_CAPTURE_QUEUE_DIR = Path("data") / "capture_queue"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def transcribe(audio_path: str) -> str:
    """Transcribe a local audio file using whisper.cpp.

    All processing is performed locally — no network calls are made
    (Requirement 4.3).

    Steps:
    1. Verify the audio file exists; log error and return ``""`` if not.
    2. Invoke ``whisper-cpp`` via subprocess with ``--output-txt`` flag.
    3. Read the generated ``.txt`` side-car file (``audio_path + ".txt"``).
    4. Return the transcript stripped of leading/trailing whitespace.

    Failure behaviour (Requirement 4.5 — preserve audio on failure):
    - Non-zero returncode: log stderr + returncode, return ``""``.
    - ``subprocess.TimeoutExpired``: log timeout, return ``""``.
    - ``FileNotFoundError`` (whisper-cpp binary missing): log error, return ``""``.
    - Any other exception: log full traceback, return ``""``.
    - The original audio file is **never** deleted or modified on failure.

    Args:
        audio_path: Absolute or relative path to the audio file.

    Returns:
        Transcript text stripped of whitespace, or ``""`` on any failure.
    """
    audio = Path(audio_path)

    # ------------------------------------------------------------------
    # Step 1 — verify the audio file exists
    # ------------------------------------------------------------------
    if not audio.exists():
        logger.error(
            "Audio file not found — cannot transcribe",
            extra={
                "component": "whisper_svc",
                "audio_path": str(audio_path),
                "timestamp": _utcnow_iso(),
            },
        )
        return ""

    # ------------------------------------------------------------------
    # Step 2 — invoke whisper.cpp (Requirement 4.2 — local binary only)
    # ------------------------------------------------------------------
    txt_path = Path(str(audio_path) + ".txt")

    try:
        result = subprocess.run(
            ["whisper-cpp", str(audio_path), "--output-txt"],
            capture_output=True,
            timeout=_WHISPER_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        logger.error(
            "whisper-cpp timed out — audio preserved",
            extra={
                "component": "whisper_svc",
                "audio_path": str(audio_path),
                "timeout_seconds": _WHISPER_TIMEOUT,
                "timestamp": _utcnow_iso(),
            },
        )
        return ""
    except FileNotFoundError:
        logger.error(
            "whisper-cpp binary not found — ensure whisper-cpp is installed and on PATH",
            extra={
                "component": "whisper_svc",
                "audio_path": str(audio_path),
                "timestamp": _utcnow_iso(),
            },
        )
        return ""
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Unexpected error running whisper-cpp — audio preserved",
            extra={
                "component": "whisper_svc",
                "audio_path": str(audio_path),
                "timestamp": _utcnow_iso(),
                "error": str(exc),
            },
            exc_info=True,
        )
        return ""

    # ------------------------------------------------------------------
    # Step 3 — handle non-zero returncode (Requirement 4.5)
    # ------------------------------------------------------------------
    if result.returncode != 0:
        logger.error(
            "whisper-cpp exited with non-zero returncode — audio preserved",
            extra={
                "component": "whisper_svc",
                "audio_path": str(audio_path),
                "returncode": result.returncode,
                "stderr": result.stderr.decode(errors="replace"),
                "timestamp": _utcnow_iso(),
            },
        )
        return ""

    # ------------------------------------------------------------------
    # Step 4 — read the generated .txt side-car file
    # ------------------------------------------------------------------
    try:
        transcript = txt_path.read_text(encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Failed to read whisper-cpp output file — audio preserved",
            extra={
                "component": "whisper_svc",
                "audio_path": str(audio_path),
                "txt_path": str(txt_path),
                "timestamp": _utcnow_iso(),
                "error": str(exc),
            },
            exc_info=True,
        )
        return ""

    # Step 5 — return transcript stripped of whitespace
    return transcript.strip()


def transcribe_and_queue(
    audio_path: str,
    domain: Optional[str] = None,
) -> dict:
    """Transcribe an audio file and enqueue the result as a ``CaptureItem``.

    Calls ``transcribe(audio_path)``, wraps the result in a ``CaptureItem``
    with ``source_type=voice``, persists it to
    ``data/capture_queue/<uuid>.json``, and returns a lightweight
    acknowledgement dict.

    No network calls are made at any point (Requirement 4.3).

    Args:
        audio_path: Path to the audio file in ``data/voice/``.
        domain:     Optional knowledge-domain tag (e.g. ``"ML"``).

    Returns:
        ``{"item_id": str, "status": str, "queued_at": str (ISO-8601)}``
    """
    transcript = transcribe(audio_path)

    item_id = uuid.uuid4()
    queued_at = datetime.now(tz=timezone.utc)

    item = CaptureItem(
        id=item_id,
        source_type=SourceType.voice,
        source_url=audio_path,
        raw_text=transcript,
        captured_at=queued_at,
        status=CaptureStatus.pending,
        domain=domain,
    )

    _persist_capture_item(item)

    return {
        "item_id": str(item_id),
        "status": item.status.value,
        "queued_at": queued_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _persist_capture_item(item: CaptureItem) -> None:
    """Write a ``CaptureItem`` to ``data/capture_queue/<item_id>.json``.

    Creates the directory if it does not exist.  Uses ``model_dump()``
    (Pydantic v2) with ``mode="json"`` so all types (UUID, datetime, enums)
    are JSON-serialisable.

    Args:
        item: The ``CaptureItem`` to persist.
    """
    _CAPTURE_QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    target = _CAPTURE_QUEUE_DIR / f"{item.id}.json"

    payload = item.model_dump(mode="json")
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    logger.info(
        "Voice CaptureItem queued",
        extra={
            "component": "whisper_svc",
            "item_id": str(item.id),
            "audio_path": item.source_url,
            "transcript_length": len(item.raw_text),
            "status": item.status.value,
            "queued_at": item.captured_at.isoformat(),
            "domain": item.domain,
        },
    )


def _utcnow_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(tz=timezone.utc).isoformat()
