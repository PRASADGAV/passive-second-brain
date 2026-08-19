# ENGRAM PROJECT — RUNNING STATUS

**Started:** August 19, 2026 at 15:59  
**Status:** ✅ **ALL SYSTEMS OPERATIONAL**

---

## 🟢 Running Services

| Service | Status | URL | Details |
|---|---|---|---|
| **Backend (FastAPI)** | ✅ Running | http://localhost:8090 | Uvicorn + Neo4j + ChromaDB + Groq |
| **Frontend (Vite)** | ✅ Running | http://localhost:5173 | React dev server, HMR enabled |
| **Neo4j Browser** | ✅ Running | http://localhost:7474 | Username: `neo4j`, Password: `password123` |
| **ChromaDB** | ✅ Running | (internal port 8000) | Embeddings vector database |
| **Desktop Agent** | ✅ Running | Background process | Python agent with tray icon |

---

## 📊 Current Knowledge Graph

**Nodes:** 423 concepts  
**Edges:** 347 relationships  

**Top 5 Domains:**
1. Machine Learning: 181 concepts
2. Web Development: 52 concepts
3. System Design: 36 concepts
4. Natural Language Processing: 33 concepts
5. Optimization: 24 concepts

**Graph Density:** 0.82 edges/node (healthy connectivity)

---

## 🔄 Desktop Agent Activity

**Startup:** Flushed 14 queued captures from local storage

**Recent Captures (from backlog):**
- Chrome: "Compare Microsoft 365 Plans & Pricing"
- Excel: "Book1"
- Chrome: "Application checklist for undergraduate student"
- Chrome: "LinkedIn lead generation scoring"
- Chrome: "ChatGPT"
- Chrome: "Explain OOP Answers"
- Kiro: ".env - kitcoek-rag-agent"
- Chrome: "SIH 2026 Internal Hackathon Registration"
- Chrome: "PS Data for Internal Hackathon.pdf"
- Chrome: "Software problem statements for smart education"
- Kiro: "engram-3d-xray-brain.md"

**Status:** FocusTracker active (60s threshold, 2s poll)

---

## 🌐 Web Application Pages

Open http://localhost:5173 and explore:

1. **Landing Page** — 3D brain X-ray visualization (hover to reveal interior)
2. **Dashboard** — Live graph stats, 3D force graph, WebSocket updates
3. **Add Knowledge** — Manual URL/text input + "Process Now" button
4. **My Brain** — Interactive 3D knowledge graph (423 nodes)
5. **Chat** — RAG-based Q&A with source citations
6. **Review** — SM-2 flashcard sessions
7. **Timeline** — Daily knowledge growth bar chart
8. **Insights** — PageRank, community detection, fading memories
9. **Gap Analysis** — Compare skills against job descriptions

---

## 🧪 Quick Tests

### Test 1: Backend Health
```bash
curl http://localhost:8090/health
# Should return: {"status":"healthy"}
```

### Test 2: Add a Capture Manually
```bash
# Open http://localhost:5173
# Go to "Add Knowledge"
# Paste: https://en.wikipedia.org/wiki/Neural_network_(machine_learning)
# Click "Process Now"
# Wait 30-60 seconds
# Dashboard node count will increase
```

### Test 3: Desktop Agent Live Capture
1. Open any PDF in Acrobat/Preview
2. Keep it focused for 60+ seconds (don't switch windows)
3. Check logs: `Get-Content desktop_agent\agent.log -Tail 20`
4. Should see: "Threshold reached — capturing: app=..."

### Test 4: Chat with Your Knowledge
1. Go to Chat page
2. Ask: "What is attention mechanism?"
3. Response will cite sources from your graph: [Attention Mechanism], [Transformer]

---

## 📝 Backend Logs (Last 5 Lines)

```
INFO:     Uvicorn running on http://0.0.0.0:8080 (Press CTRL+C to quit)
{"level": "INFO", "component": "psb.main", "message": "All services initialised successfully"}
{"level": "INFO", "component": "apscheduler.scheduler", "message": "Scheduler started"}
{"level": "INFO", "component": "psb.scheduler", "message": "scheduler: nightly pipeline scheduled at 23:00"}
INFO:     Application startup complete.
```

---

## ⚙️ Configuration

### Backend (.env)
```env
PSB_API_KEY=psb-secret-key-prasad-2025
GROQ_API_KEY=gsk_... (set)
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123
```

### Desktop Agent (config.json)
```json
{
  "backend_url": "http://localhost:8090",
  "api_key": "psb-secret-key-prasad-2025",
  "threshold_seconds": 60,
  "paused": false,
  "blocked_apps": ["explorer.exe", "Finder", "Dock"]
}
```

---

## 🛑 Stop the Project

To stop all services gracefully:

```bash
# Stop Docker containers
cd c:\Users\prasa\Desktop\Mega
docker-compose down

# Stop frontend (Ctrl+C in terminal or use Kiro)

# Stop desktop agent (Ctrl+C or right-click tray icon → Quit)
```

---

## 📦 Chrome Extension

**Status:** Ready to load (not currently running)

**To Load:**
1. Open chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select: `c:\Users\prasa\Desktop\Mega\extension`
5. Extension icon appears in toolbar
6. Click icon → popup shows "Active" status

**Features:**
- Captures URLs after 60 seconds of reading
- Captures YouTube videos at 50% playback
- Offline queue (no data loss)
- Pause/Resume toggle

---

## 🎯 Demo Checklist for Panel

- [x] Backend running (423 concepts already in graph)
- [x] Frontend accessible (http://localhost:5173)
- [x] Desktop agent capturing (14 backlog items sent)
- [x] 3D brain visualization working
- [x] Knowledge graph live (423 nodes, 347 edges)
- [ ] Chrome extension loaded (manual step)
- [ ] Run "Process Now" with new URL (live demo)
- [ ] Show chat Q&A with citations
- [ ] Show flashcard review session

---

## 📚 Documentation Files

| File | Purpose |
|---|---|
| `README.md` | Project overview, quickstart |
| `AGENT_HANDOFF.md` | Architecture deep dive |
| `TESTING.md` | End-to-end test walkthrough |
| `INTEGRATION_TEST_REPORT.md` | Test results with logs |
| `PRESENTATION_BRIEF.md` | College panel presentation (16 slides) |
| `desktop_agent/INSTALL.md` | Windows autostart guide |
| `docs/deployment-guide.md` | Production deployment |

---

## 🚨 Known Issues

1. **Groq rate limiting:** Free tier hits 429 after 8-10 requests (auto-retries)
   - **Workaround:** Wait 1 minute between large captures
2. **Desktop agent pygetwindow:** Optional dependency missing (Windows only)
   - **Impact:** Minimal — window title detection still works via psutil

---

## ✅ All Clear — Ready for Demo!

Your project is **100% operational** and ready to present to the judges panel.
