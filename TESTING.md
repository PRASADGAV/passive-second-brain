# ENGRAM — End-to-End Test Walkthrough

This guide walks you through testing the complete capture → ingestion → graph pipeline for both the Chrome Extension and Desktop Agent.

---

## Prerequisites

| Component | Status |
|---|---|
| Backend running | `docker-compose up -d` or `python -m uvicorn backend.main:app` |
| Neo4j running | Check http://localhost:7474 |
| ChromaDB folder | `backend/data/chroma/` exists |
| Frontend built | `cd frontend && npm run build` |
| Extension loaded | chrome://extensions → Load unpacked → select `extension/` |
| Desktop agent deps installed | `cd desktop_agent && pip install -r requirements.txt` |

---

## Test 1: Chrome Extension — URL capture

**Goal:** Verify that the extension captures a webpage after 60 seconds and POSTs it to `/ingest/url`.

### Steps

```bash
1. Open Chrome → click the ENGRAM extension icon in the toolbar
   → Popup shows "Active" status, queue count = 0

2. Navigate to any article (e.g. https://en.wikipedia.org/wiki/Transformer_(deep_learning))

3. Keep the tab active and focused for 60 seconds
   → Do NOT switch tabs or minimize — content.js only counts active time

4. After 60 seconds, check the extension popup:
   → "Recent Captures" log should show the Wikipedia URL with a "URL" badge
   → Queue count increments

5. Check backend logs:
   docker logs mega-backend-1 | grep ingest
   → Should show: POST /ingest/url 200

6. Check the capture queue:
   ls backend/data/capture_queue/  (or inside Docker: docker exec mega-backend-1 ls /app/data/capture_queue)
   → Should show a new <uuid>.json file with source_type=webpage
```

### Expected outcome

- Extension popup shows the captured URL in the Recent Captures log
- Backend receives the POST and writes a `CaptureItem` JSON to the queue with `status=pending`
- No errors in backend logs or extension console

---

## Test 2: Chrome Extension — YouTube capture

**Goal:** Verify that YouTube videos are captured once playback crosses 50%.

### Steps

```bash
1. Navigate to any YouTube video (e.g. https://www.youtube.com/watch?v=aircAruvnKk — 3Blue1Brown)

2. Play the video (unmuted or muted — doesn't matter)

3. Let it play past 50% of the total duration
   → content.js polls every 5 seconds and checks currentTime / duration

4. Once 50% is crossed, check the extension popup:
   → Recent Captures log shows the YouTube URL with a "YT" badge

5. Check backend logs:
   docker logs mega-backend-1 | grep ingest/youtube
   → Should show: POST /ingest/youtube 200

6. Check the capture queue:
   ls backend/data/capture_queue/
   → New .json file with source_type=youtube
```

### Expected outcome

- YouTube video is captured exactly once at 50% mark (not multiple times)
- Backend receives the POST with `video_url`, `title`, and `transcript` (if available)
- Transcript is fetched from YouTube's auto-caption API if the video has captions

---

## Test 3: Desktop Agent — PDF capture

**Goal:** Verify that the desktop agent captures a PDF after 60 seconds of focus.

### Steps

```bash
1. Start the desktop agent:
   cd desktop_agent
   python agent.py
   → Terminal shows: "ENGRAM Desktop Agent v1.0.0 starting"
   → System tray icon appears (if pystray installed)

2. Open any PDF in Acrobat Reader, SumatraPDF, or Preview (macOS)
   → Keep the PDF viewer window focused for 60 seconds
   → Do NOT switch windows — agent only counts focused time

3. After 60 seconds, check agent.log:
   tail -f desktop_agent/agent.log
   → Should show: "Threshold reached — capturing: app=Acrobat window=..."
   → Then:        "Sent desktop capture: app=Acrobat window=... item_id=..."

4. Check backend logs:
   docker logs mega-backend-1 | grep ingest/desktop
   → Should show: POST /ingest/desktop 200

5. Check the capture queue:
   ls backend/data/capture_queue/
   → New .json file with source_type=desktop, file_path set
```

### Expected outcome

- Agent extracts full text from the PDF via PyMuPDF (if installed)
- If PyMuPDF is missing, falls back to window title only
- Backend receives `app_name`, `window_title`, `text`, `file_path`, `duration_seconds`
- Agent infers a `domain` tag (e.g., "Machine Learning" for a paper PDF)

---

## Test 4: Desktop Agent — Code file capture

**Goal:** Verify that the agent captures code/text files from VS Code, Notepad++, etc.

### Steps

```bash
1. Ensure desktop agent is running (python agent.py)

2. Open a .py, .js, .md, or .txt file in VS Code or any editor
   → Keep the editor window focused for 60 seconds

3. After 60 seconds, check agent.log:
   → "Threshold reached — capturing: app=Code window=..."
   → "Sent desktop capture: app=Code window=... item_id=..."

4. Check backend logs:
   → POST /ingest/desktop 200

5. Check the capture queue:
   → New .json file with the file's full text content as raw_text
```

### Expected outcome

- Agent reads the file content directly (UTF-8, up to 1 MB)
- Domain is inferred from file extension (e.g., `.py` → "Web Development")
- No permission errors logged (if file is readable by the user)

---

## Test 5: Offline queue + retry

**Goal:** Verify that both extension and desktop agent queue captures offline and flush on reconnect.

### Chrome Extension offline test

```bash
1. Stop the backend: docker-compose down

2. Browse to an article and stay for 60+ seconds
   → Extension captures the URL

3. Check extension popup:
   → Queue count increments (stored in chrome.storage.local)

4. Restart the backend: docker-compose up -d

5. Wait a few seconds — extension background.js retries on startup
   → Queue count in popup decrements to 0
   → Backend logs show: POST /ingest/url 200
```

### Desktop Agent offline test

```bash
1. Stop the backend: docker-compose down

2. Keep a PDF focused for 60+ seconds while backend is down

3. Check agent.log:
   → "Backend unreachable — storing capture locally for later retry."

4. Check desktop_agent/local_queue.jsonl:
   → Contains a JSON object (one line) with the capture data

5. Restart the backend: docker-compose up -d

6. Agent automatically detects reconnect and flushes:
   → agent.log: "Flushing local queue backlog..."
   → agent.log: "Sent desktop capture: ... item_id=..."
   → local_queue.jsonl is emptied
```

### Expected outcome

- No captures are lost when the backend is unreachable
- Both extension and agent implement exponential backoff: 1s → 2s → 4s (3 attempts)
- Once backend is reachable, all queued items are flushed automatically

---

## Test 6: Manual pipeline trigger (Process Now)

**Goal:** Verify that the new "Process Now" button immediately runs the pipeline without waiting until midnight.

### Steps

```bash
1. Capture at least one URL or text via the Add Knowledge page

2. Click the "▶ Process Now" button on the Add Knowledge page
   → Button changes to "⟳ Running…" with spinner
   → Button remains disabled while pipeline is running

3. Wait 10–30 seconds (depends on queue size and Groq API latency)
   → Button changes to "✓ Done" (green)
   → After 5 seconds, button resets to "▶ Run Now"

4. Check backend logs:
   docker logs -f mega-backend-1 | grep pipeline
   → Shows: "Pipeline triggered manually"
   → Then:  "Processing CaptureItem <uuid> (1/N)"
   → Then:  "Concept extracted: <concept_name>"
   → Then:  "Pipeline completed"

5. Open Dashboard → My Brain (3D graph) or Timeline
   → New nodes/edges appear immediately (no page refresh needed — WebSocket updates)

6. Try clicking "Process Now" again while pipeline is running:
   → Button stays disabled
   → Status shows "Pipeline is already running." if you try via API directly
```

### Expected outcome

- Pipeline runs immediately when button is clicked
- UI polls `/pipeline/status` every 3 seconds until status ≠ "running"
- On success, knowledge graph is updated instantly
- On failure, error message is shown in the Process Now card

---

## Test 7: Duplicate prevention

**Goal:** Verify that duplicate concepts (same name + domain) from multiple sources are merged, not duplicated.

### Steps

```bash
1. Capture the same Wikipedia article twice:
   - Once via Chrome Extension (stay 60s on the page)
   - Once via Add Knowledge → URL (paste the same URL)

2. Manually trigger the pipeline: click "Process Now"

3. Check Neo4j browser (http://localhost:7474):
   MATCH (c:Concept {name: "Transformer"}) RETURN c.rep_count, c.source_type
   → rep_count should be 2 or higher (incremented for each mention)
   → Only ONE node exists, not multiple

4. Open Dashboard → My Brain → search "Transformer"
   → Only one node visible in the graph
```

### Expected outcome

- Concept extraction runs on both captures
- Neo4j MERGE query prevents duplicate nodes (upserts by name+domain)
- The node's `rep_count` increments each time the same concept appears
- No duplicate edges are created

---

## Test 8: Pause/Resume

### Chrome Extension

```bash
1. Click the extension icon → popup opens

2. Click "Pause" button
   → Status changes to "Paused" (red dot)
   → Extension badge text changes to "OFF"

3. Browse any article for 60+ seconds
   → No capture fires (content.js reads tracking_paused from storage)

4. Click "Resume"
   → Status changes to "Active" (green dot)
   → Next 60s threshold will fire normally
```

### Desktop Agent

```bash
1. Right-click the tray icon (if pystray installed) → click "Pause"
   → agent.log: "Tracking PAUSED via tray menu."

2. Focus any file for 60+ seconds
   → No capture fires (FocusTracker checks cfg['paused'] every tick)

3. Right-click tray icon → click "Resume"
   → agent.log: "Tracking RESUMED via tray menu."
   → Next 60s focus fires normally

OR edit config.json manually:
   { "paused": true }  → agent pauses on next poll tick (≤ 2s)
   { "paused": false } → agent resumes
```

### Expected outcome

- Pausing stops all capture activity immediately
- Resuming restarts tracking without any captures being lost
- Chrome Extension updates badge text to reflect paused state
- Desktop Agent tray icon color changes (red = paused, blue = active)

---

## Common issues

| Issue | Fix |
|---|---|
| Extension not capturing after 60s | Check content.js console: F12 → Console → filter "ENGRAM". Ensure tab is active (not background). Blocked domains (twitter, instagram) are ignored. |
| Desktop agent not sending captures | Check agent.log for permission errors. Ensure PyMuPDF installed (`pip install pymupdf`). On Linux, install xdotool (`sudo apt install xdotool`). |
| Backend returns 401 Unauthorized | Check `X-API-Key` header in extension popup settings and desktop_agent/config.json. Default key: `psb-secret-key-prasad-2025`. |
| Pipeline stuck on "running" | Check backend logs for Python exceptions. Check Groq API key in backend/.env (`GROQ_API_KEY`). If rate-limited, wait 1 minute and retry. |
| "Process Now" button does nothing | Open browser DevTools → Network tab → filter `/pipeline/trigger`. Check response. If 409 Conflict, pipeline is already running (wait for it to finish). |
| Neo4j connection refused | Ensure Neo4j container is running: `docker ps | grep neo4j`. Check backend/.env has correct `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`. |

---

## Success criteria

✅ Chrome Extension captures URLs after 60s and YouTube videos at 50%  
✅ Desktop Agent captures PDFs and code files after 60s of focus  
✅ Both queue captures offline and flush on reconnect (no data loss)  
✅ Backend `/ingest/*` endpoints return 200 and write to `capture_queue/`  
✅ Manual "Process Now" button runs pipeline immediately  
✅ Pipeline extracts concepts with Llama 3.3, writes to Neo4j + ChromaDB  
✅ Dashboard graph updates in real-time via WebSocket  
✅ Duplicate concepts are merged (same name+domain → one node, rep_count++)  
✅ Pause/Resume works in both extension and desktop agent  

If all tests pass, the ingestion pipeline is production-ready for your college panel demo.
