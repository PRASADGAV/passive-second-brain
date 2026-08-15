# ENGRAM Desktop Agent

A lightweight Python background process that passively tracks which application
window is actively focused on your desktop. Once a window stays focused for
≥ 60 seconds (same threshold as the Chrome Extension), it captures readable text
from that window and POSTs it to the ENGRAM backend (`POST /ingest/desktop`),
where it flows into the same nightly pipeline — concept extraction with Llama 3.3,
Neo4j knowledge graph, ChromaDB embeddings.

---

## Quick Start

```bash
# 1. Install dependencies
cd desktop_agent
pip install -r requirements.txt

# 2. Edit config (backend URL, API key, threshold)
# config.json is auto-created on first run with defaults.
# Edit it to point at your deployed backend if needed.

# 3. Run the agent
python agent.py
```

A system tray icon appears (if pystray is installed). Right-click to **Pause**
or **Quit**. The agent logs to `agent.log` in the same folder.

---

## Configuration — `config.json`

| Key | Default | Description |
|---|---|---|
| `backend_url` | `http://localhost:8090` | ENGRAM backend base URL |
| `api_key` | `psb-secret-key-prasad-2025` | `X-API-Key` header value |
| `threshold_seconds` | `60` | Seconds of active focus before capture fires |
| `paused` | `false` | Set `true` to pause without stopping the process |
| `blocked_apps` | `["explorer.exe", ...]` | App names to never capture |

Changes to `config.json` take effect on the **next poll tick** (≤ 2 seconds)
without restarting the agent.

---

## What gets captured

| Source | How text is extracted |
|---|---|
| PDF files (any viewer) | PyMuPDF extracts full page text |
| `.py`, `.js`, `.md`, `.txt`, ... | File read directly (UTF-8) |
| Other windows | Window title used as minimal text signal |

The agent infers a knowledge domain (ML, Web Dev, DevOps, etc.) from the app
name and file extension and sends it with the payload so the concept extractor
can tag nodes correctly.

---

## Offline / retry behaviour

If the backend is unreachable, captures are saved to `local_queue.jsonl`
(one JSON object per line). On the next successful connection the agent
**flushes the entire backlog** automatically. The queue is capped at 500 items
to prevent unbounded disk use — oldest items are dropped first if the cap is
reached.

Retry schedule per POST attempt: **1 s → 2 s → 4 s** (3 attempts total),
matching the Chrome Extension's exponential backoff.

---

## Platform support

| Platform | Window detection | PDF | Tray icon |
|---|---|---|---|
| **Windows** | ✅ Full (ctypes + pygetwindow) | ✅ PyMuPDF | ✅ pystray |
| **macOS** | ⚠ Partial (AppleScript app name) | ✅ PyMuPDF | ✅ pystray |
| **Linux** | ⚠ Requires `xdotool` | ✅ PyMuPDF | ✅ pystray |

Linux setup:
```bash
sudo apt install xdotool    # Debian/Ubuntu
sudo dnf install xdotool    # Fedora
```

---

## Autostart

**Windows** — add a shortcut to `agent.py` (run via `pythonw.exe` to suppress
the console) in `shell:startup`:

### Option 1: Startup Folder Shortcut (Easiest)

```powershell
cd desktop_agent
.\install_startup_shortcut.ps1
```

The agent will start automatically on next login. To uninstall:
```powershell
.\install_startup_shortcut.ps1 -Uninstall
```

### Option 2: Task Scheduler (Recommended)

More robust — auto-restarts on crash, better control.

```powershell
cd desktop_agent
.\install_windows_startup.ps1
```

To start immediately without rebooting:
```powershell
Start-ScheduledTask -TaskName "ENGRAM-Desktop-Agent"
```

To uninstall:
```powershell
.\install_windows_startup.ps1 -Uninstall
```

### Option 3: Windows Service (Most Robust — Requires Admin)

Requires [NSSM](https://nssm.cc/download) and Administrator privileges.

```powershell
# Download NSSM, extract nssm.exe to C:\tools\nssm\win64\
cd desktop_agent
.\install_windows_service.ps1 -NssmPath "C:\tools\nssm\win64\nssm.exe"
```

The service starts automatically on boot (before login) and restarts if it crashes.

---

**macOS** — create a LaunchAgent plist in `~/Library/LaunchAgents/`:
```xml
<key>ProgramArguments</key>
<array>
  <string>/usr/bin/python3</string>
  <string>/path/to/desktop_agent/agent.py</string>
</array>
```

**Linux (systemd user service)**:
```ini
[Unit]
Description=ENGRAM Desktop Agent

[Service]
ExecStart=/usr/bin/python3 /path/to/desktop_agent/agent.py
Restart=on-failure

[Install]
WantedBy=default.target
```

---

## Files

```
desktop_agent/
├── agent.py           # Main agent — entry point
├── config.json        # Runtime configuration (auto-created on first run)
├── requirements.txt   # Python dependencies
├── local_queue.jsonl  # Offline capture queue (auto-created as needed)
└── agent.log          # Log file (auto-created)
```
