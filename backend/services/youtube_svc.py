"""
youtube_svc.py — YouTube transcript service for Passive Second Brain.

Provides:
- get_transcript(video_id): fetches and joins all caption segments into a
  single string; returns "" and logs on any failure (never raises).
- extract_video_id(url): parses a YouTube URL and returns the video ID, or
  None if the URL is not a recognisable YouTube URL.
- transcript_and_queue(url, domain): end-to-end helper that extracts the
  video ID, fetches the transcript, creates a CaptureItem, persists it to
  data/capture_queue/, and returns a lightweight status dict.

Requirements: FR-02 (YouTube transcript capture), 2.2 (youtube-transcript-api),
              2.5 (store locally), 2.6 (log failure without crash)
"""

import json
import logging
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

from youtube_transcript_api import YouTubeTranscriptApi

from backend.models.schemas import CaptureItem, CaptureStatus, SourceType

logger = logging.getLogger(__name__)

# Where queued capture items are persisted (relative to repo root).
_QUEUE_DIR = Path("data") / "capture_queue"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_transcript(video_id: str) -> str:
    """
    Fetch the auto-generated or manual transcript for a YouTube video and
    return all segments joined into a single string.

    On any failure (no transcript available, private video, network error,
    etc.) the exception is logged with the video_id and a UTC timestamp, and
    an empty string is returned.  This function never raises.

    Args:
        video_id: The bare YouTube video identifier (e.g. ``"dQw4w9WgXcQ"``).

    Returns:
        Transcript text as a single space-separated string, or ``""`` on
        failure.
    """
    try:
        segments = YouTubeTranscriptApi.get_transcript(video_id)
        return " ".join(seg["text"] for seg in segments)
    except Exception:  # noqa: BLE001
        logger.error(
            "Failed to fetch transcript",
            extra={
                "component": "youtube_svc",
                "video_id": video_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "trace": traceback.format_exc(),
            },
        )
        return ""


def extract_video_id(url: str) -> Optional[str]:
    """
    Extract the YouTube video ID from a full YouTube URL.

    Handles the two canonical formats:
    - ``https://www.youtube.com/watch?v=VIDEO_ID``
    - ``https://youtu.be/VIDEO_ID``

    Args:
        url: A URL string to inspect.

    Returns:
        The video ID string if the URL is a recognised YouTube URL, otherwise
        ``None``.
    """
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return None

    host = parsed.netloc.lower()
    # Strip leading "www." for comparison.
    host = host.removeprefix("www.")

    # Long-form: youtube.com/watch?v=ID
    if host == "youtube.com":
        qs = parse_qs(parsed.query)
        ids = qs.get("v")
        if ids and ids[0]:
            return ids[0]
        return None

    # Short-form: youtu.be/ID
    if host == "youtu.be":
        # Path is "/VIDEO_ID"; strip leading slash and any trailing chars.
        path = parsed.path.lstrip("/")
        if path:
            # The video ID is the first path segment.
            video_id = path.split("/")[0]
            return video_id if video_id else None
        return None

    return None


def transcript_and_queue(url: str, domain: Optional[str] = None) -> dict:
    """
    End-to-end helper: extract video ID → fetch transcript → persist CaptureItem.

    Creates a ``CaptureItem`` with ``source_type=youtube`` and writes it as
    JSON to ``data/capture_queue/{uuid}.json``.

    Args:
        url:    A full YouTube URL (``youtube.com/watch?v=…`` or ``youtu.be/…``).
        domain: Optional knowledge-domain tag for the capture (e.g. ``"ML"``).

    Returns:
        On success::

            {"item_id": str, "status": "pending", "queued_at": str (ISO-8601)}

        On invalid URL::

            {"error": "not_a_youtube_url", "url": str}
    """
    video_id = extract_video_id(url)
    if video_id is None:
        return {"error": "not_a_youtube_url", "url": url}

    raw_text = get_transcript(video_id)

    item = CaptureItem(
        id=uuid.uuid4(),
        source_type=SourceType.youtube,
        source_url=url,
        raw_text=raw_text,
        captured_at=datetime.now(timezone.utc),
        status=CaptureStatus.pending,
        domain=domain,
    )

    # Persist to the capture queue directory.
    _QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    dest = _QUEUE_DIR / f"{item.id}.json"
    dest.write_text(item.model_dump_json(), encoding="utf-8")

    logger.info(
        "YouTube capture queued",
        extra={
            "component": "youtube_svc",
            "item_id": str(item.id),
            "video_id": video_id,
            "transcript_length": len(raw_text),
            "domain": domain,
        },
    )

    return {
        "item_id": str(item.id),
        "status": item.status.value,
        "queued_at": item.captured_at.isoformat(),
    }
