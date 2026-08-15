"""
ingest.py — Ingest API router for Passive Second Brain.

Provides 4 POST endpoints for queueing content from different sources:
  POST /ingest/url      — scrape a web page and queue it
  POST /ingest/youtube  — fetch a YouTube transcript and queue it
  POST /ingest/pdf      — upload a PDF file and queue it
  POST /ingest/text     — queue raw text directly

All endpoints are protected by the X-API-Key header via verify_api_key.

Requirements: FR-01–04, 1.7 (store locally), 7.4 (process all queued),
              27.2 (OpenAPI docs)
"""

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from backend.auth import verify_api_key
from backend.models.schemas import CaptureItem, CaptureStatus, SourceType
from backend.services import scraper, youtube_svc, pdf_svc, whisper_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])

# Directory used for temporary PDF (and voice) uploads
_UPLOAD_DIR = Path("data") / "voice"

# Directory for the text capture queue
_QUEUE_DIR = Path("data") / "capture_queue"


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class URLIngestRequest(BaseModel):
    url: str
    domain: Optional[str] = None


class YouTubeIngestRequest(BaseModel):
    url: str
    domain: Optional[str] = None


class TextIngestRequest(BaseModel):
    text: str
    domain: Optional[str] = None
    source_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/url",
    summary="Ingest a web page URL",
    response_description="Queue acknowledgement with item_id and status.",
    status_code=status.HTTP_200_OK,
)
async def ingest_url(
    body: URLIngestRequest,
    _key: str = Depends(verify_api_key),
) -> dict:
    """
    Scrape the given URL and add it to the capture queue.

    - Validates that `url` is a non-empty string.
    - Calls `scraper.scrape_and_queue(url, domain)`.
    - Returns `{item_id, status, queued_at}`.
    """
    if not body.url or not body.url.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="url must be a non-empty string.",
        )

    result = scraper.scrape_and_queue(body.url, body.domain)
    return result


@router.post(
    "/youtube",
    summary="Ingest a YouTube video transcript",
    response_description="Queue acknowledgement with item_id and status.",
    status_code=status.HTTP_200_OK,
)
async def ingest_youtube(
    body: YouTubeIngestRequest,
    _key: str = Depends(verify_api_key),
) -> dict:
    """
    Fetch the YouTube transcript for the given URL and queue it.

    - Calls `youtube_svc.transcript_and_queue(url, domain)`.
    - Returns HTTP 422 if the result contains an `"error"` key.
    - Returns `{item_id, status, queued_at}` on success.
    """
    result = youtube_svc.transcript_and_queue(body.url, body.domain)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result["error"],
        )

    return result


@router.post(
    "/pdf",
    summary="Ingest an uploaded PDF file",
    response_description="Queue acknowledgement with item_id and status.",
    status_code=status.HTTP_200_OK,
)
async def ingest_pdf(
    file: UploadFile,
    domain: Optional[str] = Form(None),
    _key: str = Depends(verify_api_key),
) -> dict:
    """
    Accept a multipart PDF upload, save it temporarily, and queue it.

    - Saves the file to `data/voice/{uuid}_{filename}`.
    - Calls `pdf_svc.pdf_and_queue(saved_path, domain)`.
    - Returns `{item_id, status, queued_at}`.
    """
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    safe_filename = Path(file.filename).name if file.filename else "upload.pdf"
    dest_filename = f"{uuid.uuid4()}_{safe_filename}"
    dest_path = _UPLOAD_DIR / dest_filename

    contents = await file.read()
    dest_path.write_bytes(contents)

    logger.info(
        "PDF uploaded",
        extra={
            "component": "ingest_router",
            "filename": safe_filename,
            "saved_as": str(dest_path),
        },
    )

    result = pdf_svc.pdf_and_queue(str(dest_path), domain)
    return result


@router.post(
    "/text",
    summary="Ingest raw text",
    response_description="Queue acknowledgement with item_id and status.",
    status_code=status.HTTP_200_OK,
)
async def ingest_text(
    body: TextIngestRequest,
    _key: str = Depends(verify_api_key),
) -> dict:
    """
    Queue a raw text snippet directly.

    - Validates that `text` is a non-empty string.
    - Creates a `CaptureItem` with `source_type=text` and writes it to the
      capture queue directory.
    - Returns `{item_id, status, queued_at}`.
    """
    if not body.text or not body.text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="text must be a non-empty string.",
        )

    now = datetime.now(timezone.utc)
    item = CaptureItem(
        id=uuid.uuid4(),
        source_type=SourceType.text,
        source_url=body.source_url or "",
        raw_text=body.text,
        captured_at=now,
        status=CaptureStatus.pending,
        domain=body.domain,
    )

    _QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    item_path = _QUEUE_DIR / f"{item.id}.json"
    item_path.write_text(item.model_dump_json(), encoding="utf-8")

    logger.info(
        "Text CaptureItem queued",
        extra={
            "component": "ingest_router",
            "item_id": str(item.id),
            "queued_at": now.isoformat(),
        },
    )

    return {
        "item_id": str(item.id),
        "status": item.status.value,
        "queued_at": now.isoformat(),
    }


@router.post(
    "/voice",
    summary="Ingest a voice note audio file",
    response_description="Queue acknowledgement with item_id and status.",
    status_code=status.HTTP_200_OK,
)
async def ingest_voice(
    file: UploadFile,
    domain: Optional[str] = Form(None),
    _key: str = Depends(verify_api_key),
) -> dict:
    """
    Accept a voice recording upload (.m4a/.mp3/.wav), transcribe it locally
    via Whisper, and queue the transcript as a CaptureItem.

    - Saves the audio file to `data/voice/{uuid}_{filename}`.
    - Calls `whisper_svc.transcribe_and_queue(saved_path, domain)`.
    - Returns `{item_id, status, queued_at}`.
    - No audio data is transmitted externally (Requirement 4.3).
    """
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    safe_filename = Path(file.filename).name if file.filename else "voice_note.m4a"
    dest_filename = f"{uuid.uuid4()}_{safe_filename}"
    dest_path = _UPLOAD_DIR / dest_filename

    contents = await file.read()
    dest_path.write_bytes(contents)

    logger.info(
        "Voice note uploaded",
        extra={
            "component": "ingest_router",
            "filename": safe_filename,
            "saved_as": str(dest_path),
        },
    )

    result = whisper_svc.transcribe_and_queue(str(dest_path), domain)

    # If the transcript is empty, whisper-cpp likely isn't installed.
    # Return the item_id (so the file is preserved) but include a warning
    # so the frontend can surface it to the user instead of showing silent "success".
    if not result.get("transcript_length") and _is_whisper_missing():
        result["warning"] = (
            "whisper-cpp binary not found on PATH. "
            "Audio was saved but transcription was skipped. "
            "Install whisper-cpp from https://github.com/ggerganov/whisper.cpp and try again."
        )

    return result


def _is_whisper_missing() -> bool:
    """Return True if whisper-cpp is not on the system PATH."""
    import shutil
    return shutil.which("whisper-cpp") is None


# ---------------------------------------------------------------------------
# Desktop agent ingest endpoint
# Receives captures from the desktop_agent/ Python background process.
# Follows the same request/response shape as /ingest/url so the same
# nightly pipeline (concept extraction → Neo4j → ChromaDB) processes it.
# ---------------------------------------------------------------------------


class DesktopIngestRequest(BaseModel):
    """
    Payload sent by the desktop agent for each captured window/document.

    Fields
    ------
    text : str
        Readable text extracted from the focused window (document body,
        clipboard text, or window title if full text is unavailable).
    app_name : str
        Name of the focused application (e.g. "Code", "Acrobat Reader").
    window_title : str
        Title of the focused window or document filename.
    file_path : str | None
        Absolute path to the file being read, if applicable.
    duration_seconds : float
        How many seconds the window was actively focused (≥ 60 by design).
    domain : str | None
        Optional knowledge domain tag supplied by the agent heuristic
        (e.g. inferred from file extension or app name).
    source_url : str | None
        Optional URL if the desktop app is a browser-like viewer.
    captured_at : str | None
        ISO-8601 UTC timestamp from the agent (defaults to server time).
    agent_version : str | None
        Semver string of the desktop agent for diagnostics.
    """

    text:             str
    app_name:         str
    window_title:     str
    file_path:        Optional[str]   = None
    duration_seconds: float           = 60.0
    domain:           Optional[str]   = None
    source_url:       Optional[str]   = None
    captured_at:      Optional[str]   = None
    agent_version:    Optional[str]   = None


@router.post(
    "/desktop",
    summary="Ingest a desktop activity capture from the desktop agent",
    response_description="Queue acknowledgement with item_id and status.",
    status_code=status.HTTP_200_OK,
)
async def ingest_desktop(
    body: DesktopIngestRequest,
    _key: str = Depends(verify_api_key),
) -> dict:
    """
    Accept a desktop capture from the desktop_agent process and queue it
    for the nightly extraction pipeline.

    Validation
    ----------
    - ``text`` must be non-empty after stripping whitespace.
    - ``app_name`` must be non-empty.
    - ``duration_seconds`` must be ≥ 0.

    The item is written to ``data/capture_queue/<uuid>.json`` with
    ``source_type=desktop`` and ``status=pending``, identical to every other
    ingest endpoint so the nightly pipeline picks it up without changes.
    """
    if not body.text or not body.text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="text must be a non-empty string.",
        )
    if not body.app_name or not body.app_name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="app_name must be a non-empty string.",
        )
    if body.duration_seconds < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="duration_seconds must be ≥ 0.",
        )

    # Parse agent-supplied timestamp; fall back to server time.
    now = datetime.now(timezone.utc)
    if body.captured_at:
        try:
            from datetime import datetime as _dt
            now = _dt.fromisoformat(body.captured_at.replace("Z", "+00:00"))
        except ValueError:
            pass  # ignore malformed timestamp; use server time

    # Build a descriptive source URL so the graph UI shows something meaningful
    # when the user inspects the captured concept's provenance.
    source_url = body.source_url or ""
    if not source_url and body.file_path:
        source_url = f"file://{body.file_path}"
    if not source_url:
        source_url = f"desktop://{body.app_name}/{body.window_title}"

    # Truncate text to 1 MB (same cap as scraper.py)
    raw_text = body.text[:1_048_576]

    item = CaptureItem(
        id=uuid.uuid4(),
        source_type=SourceType.desktop,
        source_url=source_url,
        raw_text=raw_text,
        captured_at=now,
        status=CaptureStatus.pending,
        domain=body.domain,
    )

    _QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    item_path = _QUEUE_DIR / f"{item.id}.json"
    item_path.write_text(item.model_dump_json(), encoding="utf-8")

    logger.info(
        "Desktop CaptureItem queued",
        extra={
            "component": "ingest_router",
            "item_id":         str(item.id),
            "app_name":        body.app_name,
            "window_title":    body.window_title,
            "duration_seconds": body.duration_seconds,
            "queued_at":       now.isoformat(),
        },
    )

    return {
        "item_id":   str(item.id),
        "status":    item.status.value,
        "queued_at": now.isoformat(),
    }
