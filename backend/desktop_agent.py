"""
desktop_agent.py — Desktop PDF file watcher for Passive Second Brain.

Monitors a user-configured inbox directory for newly created PDF files.
When a PDF is detected, it is extracted and queued for the nightly pipeline.

Usage:
    python -m backend.desktop_agent          # uses default inbox
    PSB_INBOX_DIR=~/my-pdfs python -m backend.desktop_agent

Requirements:
    FR-03 (PDF ingestion via desktop file watcher)
    3.2  — Desktop_Agent detects PDF via file watcher
    3.3  — Respects pause state
    3.4  — Stores raw text locally

Environment variables:
    PSB_INBOX_DIR   Directory to watch (default: ~/Documents/PSB-inbox)
    PSB_PAUSE_FILE  Path to pause-state file (default: data/psb_paused)
"""

import logging
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from watchdog.events import FileCreatedEvent, FileSystemEventHandler
from watchdog.observers import Observer

# ---------------------------------------------------------------------------
# Bootstrap — ensure imports resolve whether run as __main__ or as a module
# ---------------------------------------------------------------------------
load_dotenv()

try:
    from backend.services.pdf_svc import pdf_and_queue
except ModuleNotFoundError:
    from services.pdf_svc import pdf_and_queue

logger = logging.getLogger("psb.desktop_agent")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_INBOX = Path.home() / "Documents" / "PSB-inbox"
DEFAULT_PAUSE_FILE = Path("data") / "psb_paused"

INBOX_DIR   = Path(os.environ.get("PSB_INBOX_DIR",  str(DEFAULT_INBOX))).expanduser()
PAUSE_FILE  = Path(os.environ.get("PSB_PAUSE_FILE", str(DEFAULT_PAUSE_FILE)))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_paused() -> bool:
    """Return True if the pause-state file exists (tracking is paused)."""
    return PAUSE_FILE.exists()


def is_pdf(path: str) -> bool:
    """Return True if the path ends with .pdf (case-insensitive)."""
    return Path(path).suffix.lower() == ".pdf"


# ---------------------------------------------------------------------------
# Watchdog event handler
# ---------------------------------------------------------------------------

class PDFHandler(FileSystemEventHandler):
    """Handles file-system events in the PSB inbox directory."""

    def on_created(self, event: FileCreatedEvent) -> None:  # type: ignore[override]
        """Called when a new file or directory is created in the inbox."""
        if event.is_directory:
            return

        path = event.src_path

        if not is_pdf(path):
            logger.debug("desktop_agent: ignored non-PDF file: %s", path)
            return

        if is_paused():
            logger.info(
                "desktop_agent: tracking paused — skipping PDF: %s", path
            )
            return

        logger.info("desktop_agent: detected new PDF: %s", path)

        # Small delay to allow the file to finish writing before extraction
        time.sleep(1.0)

        try:
            result = pdf_and_queue(path)
            logger.info(
                "desktop_agent: PDF queued — item_id=%s, path=%s",
                result.get("item_id"),
                path,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "desktop_agent: failed to queue PDF %s: %s",
                path,
                exc,
                exc_info=True,
            )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run() -> None:
    """Start the file watcher and block until interrupted."""
    # Ensure the inbox directory exists
    INBOX_DIR.mkdir(parents=True, exist_ok=True)

    logger.info(
        "desktop_agent: watching %s for new PDFs (pause file: %s)",
        INBOX_DIR,
        PAUSE_FILE,
    )

    handler  = PDFHandler()
    observer = Observer()
    observer.schedule(handler, str(INBOX_DIR), recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        logger.info("desktop_agent: stopping watcher (KeyboardInterrupt)")
    finally:
        observer.stop()
        observer.join()
        logger.info("desktop_agent: stopped")


if __name__ == "__main__":
    # Configure basic logging for standalone execution
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    run()
