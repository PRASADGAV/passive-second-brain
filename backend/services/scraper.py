"""
scraper.py — URL scraper service for Passive Second Brain.

Fetches and cleans web page content using trafilatura, with:
- Pydantic URL validation
- Boilerplate/ad removal
- 1 MB output truncation
- Safe failure handling (logs and returns "" on any error)
- Capture queue integration via scrape_and_queue()
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import trafilatura
from pydantic import AnyHttpUrl, TypeAdapter, ValidationError

from backend.models.schemas import CaptureItem, CaptureStatus, SourceType

logger = logging.getLogger(__name__)

# 1 MB truncation limit per design §Input Validation
_MAX_TEXT_CHARS = 1_048_576

# Queue directory relative to project root
_QUEUE_DIR = Path("data") / "capture_queue"

# Pydantic adapter for URL validation
_url_adapter = TypeAdapter(AnyHttpUrl)


def scrape(url: str) -> str:
    """
    Fetch and extract readable text from *url*.

    Steps:
    1. Validate URL via Pydantic AnyHttpUrl — raises ValueError on invalid URL.
    2. Download page with trafilatura.fetch_url().
    3. Strip boilerplate, ads, and navigation with trafilatura.extract().
    4. Truncate to 1 MB (1,048,576 chars).
    5. On any network / extraction failure: log URL + timestamp, return "".
    6. Log a warning when extracted text is empty (paywall / JS-heavy page).

    Returns:
        Cleaned text content, or "" on failure.

    Raises:
        ValueError: If *url* is not a valid HTTP/HTTPS URL.
    """
    # --- Step 1: Validate URL ---
    try:
        _url_adapter.validate_python(url)
    except ValidationError as exc:
        raise ValueError(
            f"Invalid URL '{url}': must be a valid HTTP or HTTPS URL. Detail: {exc}"
        ) from exc

    # --- Steps 2–4: Fetch, extract, truncate ---
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded is None:
            logger.warning(
                "trafilatura.fetch_url returned None",
                extra={
                    "component": "scraper",
                    "url": url,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return ""

        text: Optional[str] = trafilatura.extract(downloaded)

        if text is None:
            logger.warning(
                "trafilatura.extract returned None — possible paywall or JS-heavy page",
                extra={
                    "component": "scraper",
                    "url": url,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return ""

        # Truncate to 1 MB
        if len(text) > _MAX_TEXT_CHARS:
            logger.info(
                "Scraped text truncated to %d chars",
                _MAX_TEXT_CHARS,
                extra={"component": "scraper", "url": url},
            )
            text = text[:_MAX_TEXT_CHARS]

        if not text.strip():
            logger.warning(
                "Extracted text is empty after stripping — possible paywall or JS-heavy page",
                extra={
                    "component": "scraper",
                    "url": url,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return ""

        return text

    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Scraping failed: %s",
            exc,
            extra={
                "component": "scraper",
                "url": url,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            exc_info=True,
        )
        return ""


def scrape_and_queue(url: str, domain: Optional[str] = None) -> dict:
    """
    Scrape *url* and persist the result as a CaptureItem in the capture queue.

    The item is written to ``data/capture_queue/<uuid>.json`` with
    ``source_type=webpage`` and ``status=pending``.

    Args:
        url:    The HTTP/HTTPS URL to scrape.
        domain: Optional knowledge domain tag (e.g. "machine-learning").

    Returns:
        dict with keys:
            - item_id   (str)  UUID of the created CaptureItem
            - status    (str)  always "pending" at creation time
            - queued_at (str)  ISO-8601 UTC timestamp
    """
    text = scrape(url)

    now = datetime.now(timezone.utc)
    item = CaptureItem(
        id=uuid.uuid4(),
        source_type=SourceType.webpage,
        source_url=url,
        raw_text=text,
        captured_at=now,
        status=CaptureStatus.pending,
        domain=domain,
    )

    _QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    item_path = _QUEUE_DIR / f"{item.id}.json"
    item_path.write_text(item.model_dump_json(), encoding="utf-8")

    logger.info(
        "CaptureItem queued",
        extra={
            "component": "scraper",
            "item_id": str(item.id),
            "url": url,
            "queued_at": now.isoformat(),
        },
    )

    return {
        "item_id": str(item.id),
        "status": item.status.value,
        "queued_at": now.isoformat(),
    }
