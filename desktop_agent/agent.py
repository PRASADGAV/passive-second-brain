"""
ENGRAM Desktop Agent
====================
Passively tracks which application window is actively focused and,
once a window has been focused for ≥ THRESHOLD seconds, captures
readable text from that window and POSTs it to POST /ingest/desktop.

Design mirrors the Chrome Extension:
  - 60-second default focus threshold (same as the extension)
  - Local JSON queue for offline / backend-unreachable situations
  - Exponential backoff retry  1 s → 2 s → 4 s  (3 attempts)
  - Pause/resume via tray icon (Windows/macOS/Linux via pystray)
  - Configuration via config.json (backend URL, API key, threshold)
  - Never crashes on permission errors, unsupported file types, or
    inaccessible windows — logs and skips every time

Supported content extraction
  - PDF files focused in any viewer  → via PyMuPDF (fitz)
  - Plain text / code files          → direct file read
  - Generic windows                  → window title fallback

Requires:
  pip install pygetwindow psutil pystray pillow requests
  # optional but recommended for better PDF support:
  pip install pymupdf
"""

from __future__ import annotations

import json
import logging
import os
import queue
import signal
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── Third-party imports with graceful degradation ─────────────────────────────

try:
    import requests
    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False
    print("[ENGRAM] ERROR: 'requests' not installed. Run: pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    import psutil
    _PSUTIL_OK = True
except ImportError:
    _PSUTIL_OK = False

try:
    import pygetwindow as gw
    _GW_OK = True
except ImportError:
    _GW_OK = False

# pystray + Pillow — optional tray icon
try:
    import pystray
    from PIL import Image, ImageDraw
    _TRAY_OK = True
except ImportError:
    _TRAY_OK = False

# PyMuPDF — optional PDF text extraction
try:
    import fitz  # PyMuPDF
    _FITZ_OK = True
except ImportError:
    _FITZ_OK = False

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(Path(__file__).parent / "agent.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("engram.desktop")

# ── Constants ─────────────────────────────────────────────────────────────────

AGENT_VERSION        = "1.0.0"
DEFAULT_THRESHOLD    = 60          # seconds
DEFAULT_BACKEND_URL  = "http://localhost:8090"
DEFAULT_API_KEY      = "psb-secret-key-prasad-2025"
POLL_INTERVAL        = 2           # seconds between focus polls
MAX_TEXT_CHARS       = 1_048_576   # 1 MB cap — matches backend scraper
MAX_QUEUE_SIZE       = 500         # cap local queue to avoid unbounded disk use
RETRY_DELAYS         = [1, 2, 4]   # exponential backoff seconds

# File-based local queue (JSON Lines — one JSON object per line)
QUEUE_FILE = Path(__file__).parent / "local_queue.jsonl"
CONFIG_FILE = Path(__file__).parent / "config.json"

# File extensions whose content we can read as plain text
TEXT_EXTENSIONS = {
    ".txt", ".md", ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c",
    ".cpp", ".h", ".cs", ".go", ".rs", ".rb", ".php", ".html", ".css",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".sh", ".bat",
    ".sql", ".r", ".ipynb",
}

# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    """Load config.json; create default if missing."""
    defaults = {
        "backend_url":        DEFAULT_BACKEND_URL,
        "api_key":            DEFAULT_API_KEY,
        "threshold_seconds":  DEFAULT_THRESHOLD,
        "paused":             False,
        "blocked_apps":       ["explorer.exe", "Finder", "Dock", "loginwindow"],
    }
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(json.dumps(defaults, indent=2), encoding="utf-8")
        log.info("Created default config at %s", CONFIG_FILE)
        return defaults
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return {**defaults, **data}   # merge: defaults fill missing keys
    except Exception as exc:
        log.warning("Failed to parse config.json (%s) — using defaults", exc)
        return defaults

def save_config(cfg: dict) -> None:
    """Persist config to disk."""
    try:
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    except Exception as exc:
        log.warning("Could not save config: %s", exc)

# ── Local queue ───────────────────────────────────────────────────────────────

_queue_lock = threading.Lock()

def enqueue_local(item: dict) -> None:
    """Append a capture item to the local JSONL queue file (thread-safe)."""
    item.setdefault("queued_at", _utcnow())
    with _queue_lock:
        try:
            # Count existing items to enforce MAX_QUEUE_SIZE
            count = 0
            if QUEUE_FILE.exists():
                with QUEUE_FILE.open("r", encoding="utf-8") as f:
                    count = sum(1 for _ in f)
            if count >= MAX_QUEUE_SIZE:
                log.warning("Local queue full (%d items) — dropping oldest entry", count)
                _drop_oldest_queue_entry()
            with QUEUE_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(item) + "\n")
        except Exception as exc:
            log.error("Failed to write local queue: %s", exc)

def _drop_oldest_queue_entry() -> None:
    """Remove the first (oldest) line from the queue file."""
    try:
        lines = QUEUE_FILE.read_text(encoding="utf-8").splitlines(keepends=True)
        if len(lines) > 1:
            QUEUE_FILE.write_text("".join(lines[1:]), encoding="utf-8")
    except Exception as exc:
        log.error("Failed to drop oldest queue entry: %s", exc)

def flush_queue(cfg: dict) -> None:
    """
    Try to POST all pending items in the local queue to the backend.
    Called on startup and after each successful POST to drain any backlog.
    """
    if not QUEUE_FILE.exists():
        return
    with _queue_lock:
        try:
            lines = QUEUE_FILE.read_text(encoding="utf-8").splitlines()
        except Exception as exc:
            log.error("Cannot read queue file: %s", exc)
            return

    if not lines:
        return

    remaining = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue   # skip corrupt entries

        success = _post_with_retry(item, cfg)
        if not success:
            remaining.append(line)   # keep for next retry

    # Rewrite queue with only the items that still failed
    with _queue_lock:
        try:
            if remaining:
                QUEUE_FILE.write_text("\n".join(remaining) + "\n", encoding="utf-8")
            else:
                QUEUE_FILE.write_text("", encoding="utf-8")
        except Exception as exc:
            log.error("Failed to rewrite queue after flush: %s", exc)

# ── Backend POST ──────────────────────────────────────────────────────────────

def _post_with_retry(payload: dict, cfg: dict) -> bool:
    """
    POST payload to /ingest/desktop with exponential backoff.
    Returns True on success, False after all retries are exhausted.
    """
    url     = cfg["backend_url"].rstrip("/") + "/ingest/desktop"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key":    cfg["api_key"],
    }
    for attempt, delay in enumerate(RETRY_DELAYS, start=1):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=15)
            if resp.ok:
                log.info(
                    "Sent desktop capture: app=%s window=%s item_id=%s",
                    payload.get("app_name"),
                    payload.get("window_title", "")[:60],
                    resp.json().get("item_id", "?"),
                )
                return True
            log.warning(
                "POST %s returned %s (attempt %d/%d): %s",
                url, resp.status_code, attempt, len(RETRY_DELAYS),
                resp.text[:200],
            )
        except requests.RequestException as exc:
            log.warning("POST %s failed (attempt %d/%d): %s", url, attempt, len(RETRY_DELAYS), exc)

        if attempt < len(RETRY_DELAYS):
            time.sleep(delay)

    return False

def send_capture(item: dict, cfg: dict) -> None:
    """
    Try to POST item to the backend.
    On failure, persist it in the local queue so it can be retried later.
    On success, flush any backlogged queue items.
    """
    success = _post_with_retry(item, cfg)
    if success:
        flush_queue(cfg)   # drain backlog if any
    else:
        log.warning("Backend unreachable — storing capture locally for later retry.")
        enqueue_local(item)

# ── Text extraction ───────────────────────────────────────────────────────────

def extract_text_from_file(file_path: str) -> Optional[str]:
    """
    Attempt to read readable text from a file path.
    Returns None on any error (permission, binary, unsupported).
    Never raises.
    """
    p = Path(file_path)
    if not p.exists() or not p.is_file():
        return None

    ext = p.suffix.lower()

    # PDF — use PyMuPDF if available
    if ext == ".pdf":
        if not _FITZ_OK:
            log.debug("PyMuPDF not installed — cannot extract PDF text from %s", file_path)
            return None
        try:
            doc  = fitz.open(file_path)
            text = "\n".join(page.get_text() for page in doc)
            doc.close()
            return text[:MAX_TEXT_CHARS] if text.strip() else None
        except Exception as exc:
            log.debug("PDF extraction failed for %s: %s", file_path, exc)
            return None

    # Plain text / code files
    if ext in TEXT_EXTENSIONS:
        try:
            return p.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT_CHARS]
        except PermissionError:
            log.debug("Permission denied reading %s", file_path)
            return None
        except Exception as exc:
            log.debug("Cannot read %s: %s", file_path, exc)
            return None

    return None   # unsupported extension — skip silently

def get_active_window_info() -> Optional[dict]:
    """
    Return information about the currently focused window.
    Returns None if focus cannot be determined.
    Shape: { title, app, pid, file_path }
    """
    title    = ""
    app_name = ""
    pid      = None
    file_path: Optional[str] = None

    # ── pygetwindow (Windows/macOS partial) ───────────────────────────────
    if _GW_OK:
        try:
            active = gw.getActiveWindow()
            if active:
                title = active.title or ""
        except Exception:
            pass

    # ── psutil: derive app name + pid from foreground process ─────────────
    if _PSUTIL_OK:
        try:
            # On Windows, use GetForegroundWindow via ctypes
            if sys.platform == "win32":
                import ctypes
                hwnd = ctypes.windll.user32.GetForegroundWindow()
                buf_pid = ctypes.c_ulong()
                ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(buf_pid))
                pid = buf_pid.value
            # On Linux, try xdotool / wmctrl (best-effort)
            elif sys.platform.startswith("linux"):
                try:
                    import subprocess
                    result = subprocess.run(
                        ["xdotool", "getactivewindow", "getwindowname"],
                        capture_output=True, text=True, timeout=2
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        title = result.stdout.strip()
                except Exception:
                    pass
            # macOS — NSWorkspace via applescript (best-effort)
            elif sys.platform == "darwin":
                try:
                    import subprocess
                    script = 'tell application "System Events" to name of first application process whose frontmost is true'
                    result = subprocess.run(
                        ["osascript", "-e", script],
                        capture_output=True, text=True, timeout=2
                    )
                    if result.returncode == 0:
                        app_name = result.stdout.strip()
                except Exception:
                    pass

            if pid:
                proc = psutil.Process(pid)
                app_name = app_name or proc.name()

                # Try to infer the open file from process cmdline or open files
                try:
                    cmdline = proc.cmdline()
                    for arg in reversed(cmdline[1:]):   # skip executable
                        candidate = Path(arg)
                        if candidate.exists() and candidate.is_file():
                            file_path = str(candidate.resolve())
                            break
                except (psutil.AccessDenied, psutil.NoSuchProcess):
                    pass

        except (psutil.AccessDenied, psutil.NoSuchProcess, Exception) as exc:
            log.debug("psutil focus detection error: %s", exc)

    if not title and not app_name:
        return None

    return {
        "title":     title,
        "app":       app_name or "Unknown",
        "pid":       pid,
        "file_path": file_path,
    }

# ── Focus tracker ─────────────────────────────────────────────────────────────

class FocusTracker:
    """
    Polls the active window every POLL_INTERVAL seconds.
    When a window stays focused for ≥ threshold seconds, captures its content.
    """

    def __init__(self, cfg: dict) -> None:
        self.cfg              = cfg
        self._current_key     = None   # identifies the current window
        self._focus_start     = None   # monotonic time when current window gained focus
        self._captured_keys: set = set()  # prevent duplicate captures per session
        self._stop_event      = threading.Event()
        self._thread          = threading.Thread(target=self._run, daemon=True, name="FocusTracker")

    # ── public ────────────────────────────────────────────────────────────

    def start(self) -> None:
        self._thread.start()
        log.info("FocusTracker started (threshold=%ds, poll=%ds)",
                 self.cfg["threshold_seconds"], POLL_INTERVAL)

    def stop(self) -> None:
        self._stop_event.set()

    def reload_config(self, cfg: dict) -> None:
        self.cfg = cfg

    # ── internal ──────────────────────────────────────────────────────────

    def _window_key(self, info: dict) -> str:
        """Stable identifier for a window (app + title)."""
        return f"{info['app']}::{info['title']}"

    def _is_blocked(self, info: dict) -> bool:
        blocked = self.cfg.get("blocked_apps", [])
        app_lower = info["app"].lower()
        return any(b.lower() in app_lower for b in blocked)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:
                log.error("FocusTracker tick error: %s", exc)
            self._stop_event.wait(POLL_INTERVAL)

    def _tick(self) -> None:
        # Reload config on each tick so pause/threshold changes take effect
        self.cfg = load_config()

        if self.cfg.get("paused", False):
            self._current_key  = None
            self._focus_start  = None
            return

        info = get_active_window_info()
        if info is None:
            return

        if self._is_blocked(info):
            self._current_key = None
            self._focus_start = None
            return

        key = self._window_key(info)
        now = time.monotonic()

        if key != self._current_key:
            # Focus changed — reset timer
            self._current_key = key
            self._focus_start = now
            return

        # Same window — check if threshold crossed
        focused_for = now - (self._focus_start or now)
        threshold   = self.cfg.get("threshold_seconds", DEFAULT_THRESHOLD)

        if focused_for < threshold:
            return   # not there yet

        # Threshold crossed — check if already captured this session
        if key in self._captured_keys:
            return

        self._captured_keys.add(key)
        self._focus_start = now   # reset so it won't re-fire until re-focused

        self._do_capture(info, focused_for)

    def _do_capture(self, info: dict, focused_for: float) -> None:
        """Extract text and dispatch to backend."""
        title     = info["title"]
        app       = info["app"]
        file_path = info.get("file_path")

        # Attempt file text extraction first; fall back to title
        text: Optional[str] = None
        if file_path:
            text = extract_text_from_file(file_path)

        if not text or not text.strip():
            # Use window title as minimal text signal — still useful for the
            # concept extractor to log what the user was working on
            text = f"[Desktop activity] App: {app} | Window: {title}"

        # Heuristic domain tagging from file extension / app name
        domain = _infer_domain(app, file_path)

        payload = {
            "text":             text,
            "app_name":         app,
            "window_title":     title,
            "file_path":        file_path,
            "duration_seconds": round(focused_for, 1),
            "domain":           domain,
            "source_url":       None,
            "captured_at":      _utcnow(),
            "agent_version":    AGENT_VERSION,
        }

        log.info(
            "Threshold reached — capturing: app=%s title=%s duration=%.0fs",
            app, title[:60], focused_for,
        )
        send_capture(payload, self.cfg)

# ── Domain heuristic ──────────────────────────────────────────────────────────

_APP_DOMAIN_MAP = {
    "code":       "Web Development",
    "vscode":     "Web Development",
    "pycharm":    "Web Development",
    "intellij":   "Web Development",
    "webstorm":   "Web Development",
    "acrobat":    "General",
    "sumatra":    "General",
    "evince":     "General",
    "zotero":     "General",
    "jupyter":    "Data Science",
    "rstudio":    "Data Science",
    "matlab":     "Machine Learning",
    "spyder":     "Data Science",
    "terminal":   "DevOps",
    "iterm":      "DevOps",
    "powershell": "DevOps",
    "cmd":        "DevOps",
}
_EXT_DOMAIN_MAP = {
    ".py":    "Web Development",
    ".ipynb": "Data Science",
    ".r":     "Data Science",
    ".sql":   "Database",
    ".tf":    "DevOps",
    ".yaml":  "DevOps",
    ".yml":   "DevOps",
    ".sh":    "DevOps",
    ".java":  "Web Development",
    ".cs":    "Web Development",
    ".go":    "Web Development",
    ".rs":    "Web Development",
    ".cpp":   "Web Development",
    ".c":     "Web Development",
}

def _infer_domain(app_name: str, file_path: Optional[str]) -> Optional[str]:
    """Best-effort domain inference from app name or file extension."""
    app_lower = app_name.lower()
    for key, domain in _APP_DOMAIN_MAP.items():
        if key in app_lower:
            return domain
    if file_path:
        ext = Path(file_path).suffix.lower()
        if ext in _EXT_DOMAIN_MAP:
            return _EXT_DOMAIN_MAP[ext]
    return None

# ── Tray icon ─────────────────────────────────────────────────────────────────

def _create_tray_icon_image(color: str = "#818cf8") -> "Image.Image":
    """Generate a simple 64×64 brain-dot icon for the system tray."""
    img  = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
    draw.ellipse([8, 8, 56, 56], fill=(r, g, b, 220))
    draw.ellipse([24, 24, 40, 40], fill=(255, 255, 255, 180))
    return img

def run_tray(tracker: FocusTracker) -> None:
    """Run the system tray icon with Pause/Resume + Quit menu items."""
    if not _TRAY_OK:
        log.info("pystray not installed — running without tray icon. Ctrl+C to quit.")
        return

    cfg = load_config()

    def on_pause_resume(icon, item):
        cfg2 = load_config()
        cfg2["paused"] = not cfg2.get("paused", False)
        save_config(cfg2)
        tracker.reload_config(cfg2)
        _update_icon(icon, cfg2)
        log.info("Tracking %s via tray menu.", "PAUSED" if cfg2["paused"] else "RESUMED")

    def on_quit(icon, item):
        log.info("Quit requested via tray menu.")
        tracker.stop()
        icon.stop()

    def _update_icon(icon, cfg2):
        color  = "#ef4444" if cfg2.get("paused") else "#818cf8"
        label  = "Resume" if cfg2.get("paused") else "Pause"
        icon.icon  = _create_tray_icon_image(color)
        icon.title = f"ENGRAM Desktop Agent — {'Paused' if cfg2.get('paused') else 'Active'}"
        icon.menu  = pystray.Menu(
            pystray.MenuItem(label, on_pause_resume),
            pystray.MenuItem("Quit", on_quit),
        )

    icon = pystray.Icon(
        name="engram",
        icon=_create_tray_icon_image("#818cf8"),
        title="ENGRAM Desktop Agent — Active",
        menu=pystray.Menu(
            pystray.MenuItem("Pause",  on_pause_resume),
            pystray.MenuItem("Quit",   on_quit),
        ),
    )
    icon.run()   # blocks until quit

# ── Utilities ─────────────────────────────────────────────────────────────────

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()

# ── Signal handling ───────────────────────────────────────────────────────────

_tracker_ref: Optional[FocusTracker] = None

def _handle_signal(sig, frame):
    log.info("Signal %s received — shutting down.", sig)
    if _tracker_ref:
        _tracker_ref.stop()
    sys.exit(0)

signal.signal(signal.SIGINT,  _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)

# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    global _tracker_ref

    log.info("=" * 55)
    log.info("ENGRAM Desktop Agent v%s starting", AGENT_VERSION)
    log.info("Config: %s", CONFIG_FILE)
    log.info("Queue:  %s", QUEUE_FILE)
    log.info("=" * 55)

    if not _REQUESTS_OK:
        log.error("'requests' library not found. Install it and try again.")
        sys.exit(1)
    if not _PSUTIL_OK:
        log.warning("'psutil' not installed — app name detection limited.")
    if not _GW_OK:
        log.warning("'pygetwindow' not installed — window title detection limited.")
    if not _FITZ_OK:
        log.warning("'pymupdf' not installed — PDF text extraction disabled.")
    if not _TRAY_OK:
        log.warning("'pystray'/'pillow' not installed — no tray icon.")

    cfg = load_config()
    log.info(
        "Config loaded: backend=%s threshold=%ds paused=%s",
        cfg["backend_url"], cfg["threshold_seconds"], cfg["paused"],
    )

    # Flush any items that were queued while offline during a previous session
    log.info("Flushing local queue backlog…")
    flush_queue(cfg)

    tracker = FocusTracker(cfg)
    _tracker_ref = tracker
    tracker.start()

    # Run tray icon (blocks) or fall through to a simple keep-alive loop
    if _TRAY_OK:
        run_tray(tracker)
    else:
        log.info("Running headless. Press Ctrl+C to quit.")
        try:
            while True:
                time.sleep(5)
        except KeyboardInterrupt:
            pass
        finally:
            tracker.stop()

    log.info("ENGRAM Desktop Agent stopped.")


if __name__ == "__main__":
    main()
