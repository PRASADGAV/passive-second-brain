# ENGRAM Desktop Agent — Installation Guide

Choose the installation method that fits your needs:

---

## Quick Install (Recommended for Most Users)

### 1. Install Dependencies

```bash
cd desktop_agent
pip install -r requirements.txt
```

This installs:
- `requests` — HTTP client for backend communication
- `psutil` — Active window/process detection
- `pystray` + `Pillow` — System tray icon with Pause/Resume menu
- `pymupdf` — PDF text extraction

### 2. Configure Backend URL

Edit `config.json`:
```json
{
  "backend_url": "http://localhost:8090",
  "api_key": "psb-secret-key-prasad-2025",
  "threshold_seconds": 60,
  "paused": false
}
```

If your backend is deployed remotely, change `backend_url` to your production URL.

### 3. Run the Agent

```bash
python agent.py
```

A system tray icon appears. Right-click it to **Pause**, **Resume**, or **Quit**.

---

## Autostart Options

### Option 1: Startup Folder Shortcut (Easiest)

**Best for:** Quick setup, no admin rights needed  
**When it runs:** On login  
**Pros:** Simple, works immediately  
**Cons:** Only runs when you're logged in

```powershell
cd desktop_agent
.\install_startup_shortcut.ps1
```

✓ Done. Log out and log back in, or double-click the shortcut in `shell:startup`.

**To uninstall:**
```powershell
.\install_startup_shortcut.ps1 -Uninstall
```

---

### Option 2: Task Scheduler (Recommended)

**Best for:** Reliable autostart with crash recovery  
**When it runs:** On login  
**Pros:** Auto-restarts on crash (3 attempts), better logging, no admin needed  
**Cons:** Slightly more complex uninstall

```powershell
cd desktop_agent
.\install_windows_startup.ps1
```

**To start immediately without rebooting:**
```powershell
Start-ScheduledTask -TaskName "ENGRAM-Desktop-Agent"
```

**To check if it's running:**
```powershell
Get-ScheduledTask -TaskName "ENGRAM-Desktop-Agent" | Select-Object State, LastRunTime
```

**To view logs:**
```powershell
Get-Content agent.log -Tail 50 -Wait
```

**To uninstall:**
```powershell
.\install_windows_startup.ps1 -Uninstall
```

---

### Option 3: Windows Service (Most Robust)

**Best for:** Always-on production use, multi-user machines  
**When it runs:** On boot (before login)  
**Pros:** Runs as a system service, survives logout, best crash recovery  
**Cons:** Requires admin rights, requires NSSM download

#### Prerequisites

1. **Download NSSM** (Non-Sucking Service Manager):  
   https://nssm.cc/download

2. Extract `nssm.exe` to a folder (e.g., `C:\tools\nssm\win64\`)

3. **Run PowerShell as Administrator**

#### Install

```powershell
cd desktop_agent
.\install_windows_service.ps1 -NssmPath "C:\tools\nssm\win64\nssm.exe"
```

The service starts automatically. To check status:
```powershell
Get-Service -Name "ENGRAM-Desktop-Agent"
```

**To stop/start:**
```powershell
Stop-Service -Name "ENGRAM-Desktop-Agent"
Start-Service -Name "ENGRAM-Desktop-Agent"
```

**To uninstall:**
```powershell
.\install_windows_service.ps1 -Uninstall
```

---

## Troubleshooting

### Agent doesn't capture anything

1. **Check if it's running:**
   ```powershell
   Get-Process -Name pythonw -ErrorAction SilentlyContinue
   ```

2. **Check logs:**
   ```powershell
   Get-Content desktop_agent\agent.log -Tail 50
   ```

3. **Common issues:**
   - Backend not reachable → check `config.json` `backend_url`
   - Wrong API key → check `config.json` `api_key` matches backend `.env`
   - Permission errors → run agent as your regular user (not admin)
   - `pygetwindow` missing → install: `pip install pygetwindow` (optional)

### Agent is paused

Check the tray icon color:
- **Blue** = active
- **Red** = paused

Right-click tray icon → **Resume**, or edit `config.json`:
```json
{ "paused": false }
```

### Backend returns 401 Unauthorized

The `X-API-Key` in `config.json` must match the `PSB_API_KEY` in `backend/.env`:

**config.json:**
```json
{ "api_key": "psb-secret-key-prasad-2025" }
```

**backend/.env:**
```env
PSB_API_KEY=psb-secret-key-prasad-2025
```

### Captures aren't appearing in the graph

1. **Check if captures are queued:**
   ```bash
   docker exec mega-backend-1 ls /app/data/capture_queue/
   ```

2. **Manually trigger the pipeline:**
   - Open http://localhost:5173
   - Go to **Add Knowledge**
   - Click **"▶ Process Now"**
   - Wait 30-60 seconds

3. **Or wait until midnight** (nightly pipeline runs at 23:00)

---

## Verification

After installation, verify the agent is working:

1. **Open any PDF in Acrobat/Preview** (or a `.py` file in VS Code)
2. **Keep it focused for 60+ seconds** (don't switch windows)
3. **Check agent.log:**
   ```powershell
   Get-Content desktop_agent\agent.log -Tail 20
   ```
   You should see:
   ```
   Threshold reached — capturing: app=Acrobat window=...
   Sent desktop capture: app=Acrobat window=... item_id=...
   ```

4. **Check backend logs:**
   ```bash
   docker logs mega-backend-1 | grep ingest/desktop
   ```
   You should see:
   ```
   POST /ingest/desktop 200
   ```

5. **Trigger pipeline and check graph:**
   - Open http://localhost:5173 → **Add Knowledge** → **"Process Now"**
   - Go to **Dashboard** → see node count increase

---

## Advanced Configuration

### Change the threshold

Edit `config.json`:
```json
{ "threshold_seconds": 30 }  // 30 seconds instead of 60
```

Changes take effect on the next poll tick (≤ 2 seconds).

### Block specific applications

Edit `config.json`:
```json
{
  "blocked_apps": [
    "explorer.exe",
    "Finder",
    "Discord",
    "Spotify"
  ]
}
```

### Offline queue

If the backend is unreachable, captures are saved to `local_queue.jsonl`.  
On reconnect, the agent automatically flushes the queue.

To manually inspect the queue:
```powershell
Get-Content desktop_agent\local_queue.jsonl
```

---

## Uninstallation

1. **Stop the agent** (if running as a service/task):
   ```powershell
   # Task Scheduler:
   .\install_windows_startup.ps1 -Uninstall

   # Startup Folder:
   .\install_startup_shortcut.ps1 -Uninstall

   # Windows Service:
   .\install_windows_service.ps1 -Uninstall
   ```

2. **(Optional) Remove the agent folder:**
   ```powershell
   cd ..
   Remove-Item -Recurse -Force desktop_agent
   ```

3. **(Optional) Remove Python dependencies:**
   ```bash
   pip uninstall -y requests psutil pystray pillow pymupdf pygetwindow
   ```
