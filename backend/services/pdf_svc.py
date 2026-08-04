"""
pdf_svc.py — PDF text extraction service for Passive Second Brain.

Provides:
  extract_pdf(path_or_url)   — page-by-page extraction, returns List[str]
  pdf_and_queue(path_or_url) — extract + enqueue as CaptureItem, returns {item_id, status, queued_at}

Design spec: Layer 2 Services — pdf_svc.py
Requirements:
  FR-03 (PDF ingestion)
  3.1  — page-by-page extraction using PyMuPDF
  3.4  — store raw text locally (data/capture_queue/<uuid>.json)
  3.5  — log page-level failure and continue remaining pages
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import fitz  # PyMuPDF

from backend.models.schemas import CaptureItem, CaptureStatus, SourceType

logger = logging.getLogger(__name__)

# Maximum number of pages processed per document (Requirement 3.1 — cap)
MAX_PAGES = 1000

# Directory where capture items are persisted (Requirement 3.4)
_CAPTURE_QUEUE_DIR = Path("data") / "capture_queue"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_pdf(path_or_url: str) -> List[str]:
    """Extract text from every page of a PDF file or URL.

    Opens the document with ``fitz.open()``, iterates through all pages
    (up to MAX_PAGES), and calls ``page.get_text()`` on each one.

    Per-page failure behaviour (Requirement 3.5):
        - Log ``{file_id, page_number, timestamp}``
        - Append ``""`` for the failed page
        - Continue to the next page — never abort

    Whole-file failure behaviour (corrupt / password-protected file):
        - Log the full error with ``path_or_url`` and timestamp
        - Return ``[]``

    Args:
        path_or_url: Filesystem path or URL pointing to the PDF.

    Returns:
        A list of exactly N strings where N is the total page count.
        Each element is the extracted text for that page (1-indexed page
        numbers, zero-indexed list positions).  Failed pages are represented
        by an empty string ``""``.  Returns ``[]`` if the file cannot be
        opened at all.
    """
    file_id = _derive_file_id(path_or_url)
    now_iso = _utcnow_iso()

    # ------------------------------------------------------------------
    # Attempt to open the document
    # ------------------------------------------------------------------
    try:
        doc = fitz.open(path_or_url)
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "PDF failed to open — cannot extract text",
            extra={
                "component": "pdf_svc",
                "file_path": path_or_url,
                "timestamp": now_iso,
                "error": str(exc),
            },
            exc_info=True,
        )
        return []

    total_pages = doc.page_count

    # ------------------------------------------------------------------
    # Page-count cap (design requirement: log warning, stop at 1000)
    # ------------------------------------------------------------------
    if total_pages > MAX_PAGES:
        logger.warning(
            "PDF exceeds %d-page cap — processing first %d pages only",
            MAX_PAGES,
            MAX_PAGES,
            extra={
                "component": "pdf_svc",
                "file_id": file_id,
                "total_pages": total_pages,
                "pages_processed": MAX_PAGES,
                "timestamp": _utcnow_iso(),
            },
        )
        pages_to_process = MAX_PAGES
    else:
        pages_to_process = total_pages

    # ------------------------------------------------------------------
    # Page-by-page extraction
    # ------------------------------------------------------------------
    results: List[str] = []

    for page_index in range(pages_to_process):
        page_number = page_index + 1  # 1-based for logging
        try:
            page = doc[page_index]
            text = page.get_text()
            results.append(text)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "PDF page extraction failed — appending empty string and continuing",
                extra={
                    "component": "pdf_svc",
                    "file_id": file_id,
                    "page_number": page_number,
                    "timestamp": _utcnow_iso(),
                    "error": str(exc),
                },
            )
            results.append("")

    doc.close()
    return results


def pdf_and_queue(
    path_or_url: str,
    domain: Optional[str] = None,
) -> dict:
    """Extract PDF text and enqueue it as a ``CaptureItem`` for nightly processing.

    Calls ``extract_pdf()``, joins all page strings into a single raw-text
    blob, creates a ``CaptureItem`` with ``source_type=pdf`` and
    ``status=pending``, persists it to ``data/capture_queue/<uuid>.json``,
    and returns a lightweight acknowledgement dict.

    Args:
        path_or_url: Filesystem path or URL pointing to the PDF.
        domain:      Optional user-defined learning domain tag.

    Returns:
        ``{"item_id": str, "status": str, "queued_at": str}``
    """
    pages = extract_pdf(path_or_url)
    raw_text = "\n\n".join(pages)  # join page texts with paragraph breaks

    item_id = uuid.uuid4()
    queued_at = datetime.now(tz=timezone.utc)

    item = CaptureItem(
        id=item_id,
        source_type=SourceType.pdf,
        source_url=path_or_url,
        raw_text=raw_text,
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
        "CaptureItem queued",
        extra={
            "component": "pdf_svc",
            "item_id": str(item.id),
            "source_url": item.source_url,
            "status": item.status.value,
            "queued_at": item.captured_at.isoformat(),
        },
    )


def _derive_file_id(path_or_url: str) -> str:
    """Return a short, stable identifier for ``path_or_url`` used in log entries.

    Uses the last path component (filename) when available; otherwise falls
    back to the full string truncated to 120 characters.

    Args:
        path_or_url: Filesystem path or URL.

    Returns:
        A human-readable string suitable for log fields.
    """
    try:
        return Path(path_or_url).name or path_or_url[:120]
    except Exception:  # noqa: BLE001
        return path_or_url[:120]


def _utcnow_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(tz=timezone.utc).isoformat()
