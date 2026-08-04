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
    return result
