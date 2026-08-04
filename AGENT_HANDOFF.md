# PASSIVE SECOND BRAIN — Agent Handoff Document

**Read this entire document before doing anything. Every detail matters.**

---

## What This Project Is

**Passive Second Brain** is a final-year B.Tech capstone project (KIT's College of Engineering, Kolhapur) by Prasad.  
Domain: CSE — Artificial Intelligence & Machine Learning, 2025-2026.

It is an AI-powered personal knowledge management system that passively captures a user's digital learning activity (web browsing, YouTube videos, PDFs, voice notes) and automatically builds a semantic knowledge graph — requiring zero manual effort from the user.

**One-line pitch:** "An AI system that silently watches how you learn, automatically builds a semantic map of your knowledge, and ensures nothing you ever studied is forgotten."

---

## Project Location

```
C:\Users\prasa\Desktop\Mega\
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Browser Extension | Chrome Extension MV3 (JavaScript) |
| Backend API | FastAPI (Python 3.11) |
| LLM | Groq API — Llama 3.3 70B |
| Knowledge Graph DB | Neo4j 5.18 |
| Vector DB | ChromaDB (local) |
| Scheduler | APScheduler (nightly at 23:00) |
| Frontend | React 18 + Vite |
| Graph Visualisation | D3.js + custom 3D Carousel |
| Animations | Framer Motion |
| Styling | Custom CSS (OBYS editorial — white/black/monochrome) |
| Fonts | Bebas Neue, Inter, JetBrains Mono |
| DevOps | Docker Compose |

---

## Folder Structure

```
Mega/
├── backend/                    ← FastAPI Python backend
│   ├── main.py                 ← App entry point, all routers registered here
│   ├── auth.py                 ← verify_api_key dependency
│   ├── desktop_agent.py        ← PDF file watcher (watchdog)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env                    ← NEVER commit this
│   ├── .env.example
│   ├── models/
│   │   └── schemas.py          ← All Pydantic models (ConceptNode, Edge, etc.)
│   ├── routers/
│   │   ├── ingest.py           ← POST /ingest/url|youtube|pdf|text|voice
│   │   ├── graph.py            ← GET/POST/DELETE /graph/* + POST /graph/seed
│   │   ├── chat.py             ← POST /chat (RAG)
│   │   ├── digest.py           ← GET /digest/today|history
│   │   ├── memory.py           ← GET /memory/alerts, POST /memory/review/{id}
│   │   ├── gaps.py             ← POST /gaps
│   │   ├── report.py           ← GET /report/weekly
│   │   └── playground.py       ← POST /playground (dev mode only)
│   ├── services/
│   │   ├── graph_db.py         ← Neo4jService (upsert, CRUD, neighbourhood)
│   │   ├── vector_db.py        ← VectorDBService (ChromaDB embeddings)
│   │   ├── groq_client.py      ← GroqClient (call, call_with_history)
│   │   ├── scraper.py          ← trafilatura URL scraper
│   │   ├── youtube_svc.py      ← YouTube transcript fetcher
│   │   ├── pdf_svc.py          ← PyMuPDF page extractor
│   │   ├── whisper_svc.py      ← whisper.cpp local transcription
│   │   ├── chunker.py          ← 512-token overlapping chunker (tiktoken)
│   │   ├── extractor.py        ← Groq concept + relationship extraction
│   │   ├── resolver.py         ← Entity resolution + deduplication
│   │   ├── rag.py              ← Hybrid RAG (ChromaDB + Neo4j + Groq)
│   │   ├── sm2.py              ← SM-2 forgetting score algorithm
│   │   ├── scheduler.py        ← Nightly batch pipeline (APScheduler)
│   │   └── digest_gen.py       ← Daily digest generation
│   ├── prompts/
│   │   ├── extract.py          ← Concept extraction system prompt
│   │   ├── digest.py           ← Digest generation prompt
│   │   └── gaps.py             ← Skill extraction prompt
│   └── tests/                  ← 228 passing tests (pytest + Hypothesis)
│
├── extension/                  ← Chrome Extension MV3
│   ├── manifest.json
│   ├── content.js              ← 60s reading timer, YT 50% trigger
│   ├── background.js           ← Service worker, queue, POST to backend
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js            ← Pause/resume toggle
│   └── utils/
│       ├── domain-filter.js    ← isBlocked() function
│       └── youtube.js          ← getVideoProgress(), extractVideoId()
│
├── frontend/                   ← React 18 + Vite frontend
│   ├── vite.config.js          ← Proxy: /api → localhost:8090, /ws → ws:8090
│   ├── .env                    ← VITE_API_KEY, VITE_API_BASE_URL
│   └── src/
│       ├── index.css           ← FULL design system (OBYS editorial style)
│       ├── App.jsx             ← Main app shell + routing
│       ├── animations.js       ← Framer Motion variants
│       ├── api/
│       │   └── client.js       ← Axios client + all API methods
│       ├── hooks/
│       │   ├── useGraph.js     ← Graph data + WebSocket node updates
│       │   ├── useWebSocket.js ← WS connection to /ws
│       │   └── useChat.js      ← Chat session state
│       └── components/
│           ├── LandingPage.jsx     ← Onboarding landing (white, Bebas Neue)
│           ├── Onboarding.jsx      ← 4-step setup wizard
│           ├── Carousel3D.jsx      ← Main 3D rotating card graph view
│           ├── FloatingGraphPage.jsx ← Full-screen OBYS floating cards view
│           ├── FloatingGraphPage.css ← Dark editorial CSS for floating view
│           ├── GraphCanvas.jsx     ← D3.js force-directed graph (alternative)
│           ├── NodeDetail.jsx      ← Slide-in node detail panel
│           ├── ChatPanel.jsx       ← RAG chat interface
│           ├── DigestPanel.jsx     ← Daily digest + fading alerts
│           ├── InputPanel.jsx      ← URL/text/PDF/voice input
│           ├── GapAnalyser.jsx     ← Job description gap detection
│           ├── PrivacyPanel.jsx    ← Data control + deletion
│           ├── WeeklyReport.jsx    ← PDF report download
│           ├── PromptPlayground.jsx ← Dev mode prompt tester
│           └── Cursor.jsx          ← Custom cursor dot
│
├── data/                       ← Runtime data (gitignored)
│   ├── capture_queue/          ← Pending CaptureItem JSON files
│   ├── digests/                ← Daily digest JSON files
│   ├── voice/                  ← Voice recordings (chmod 600)
│   └── sample/                 ← Sample graph seed data
│
├── docs/
│   ├── mentor_sessions.md
│   └── extension-sideload.md
│
├── docker-compose.yml          ← Neo4j + ChromaDB + Backend
├── .env                        ← Root env (NEO4J_PASSWORD for Docker)
├── .gitignore
└── README.md
```

---

## Environment Variables

### `backend/.env` (DO NOT SHARE)
```
GROQ_API_KEY=gsk_your_groq_api_key_here
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password_here
PSB_API_KEY=your_psb_api_key_here
DEVELOPER_MODE=false
CHROMA_HOST=localhost
CHROMA_PORT=8000
```

### `frontend/.env`
```
VITE_API_BASE_URL=/api
VITE_API_KEY=your_psb_api_key_here
VITE_DEVELOPER_MODE=true
```

### Root `.env`
```
NEO4J_PASSWORD=Prasadgav2123
```

---

## How to Run

### Start everything:
```powershell
cd C:\Users\prasa\Desktop\Mega
docker compose up -d           # starts Neo4j + ChromaDB + FastAPI backend

cd frontend
npm run dev                    # starts Vite dev server at localhost:5173
```

### Backend runs at: `http://localhost:8090`
### Frontend runs at: `http://localhost:5173`
### Vite proxy: `/api/*` → `http://localhost:8090/*`

### Stop everything:
```powershell
docker compose down
```

---

## Key API Endpoints

All endpoints require header: `X-API-Key: psb-secret-key-prasad-2025`

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check (public) |
| GET | /pipeline/status | Pipeline run status (public) |
| POST | /pipeline/trigger | Manually trigger nightly pipeline |
| POST | /graph/seed | Seed 50 sample concepts (onboarding) |
| GET | /graph/nodes | List all concept nodes |
| GET | /graph/stats | Node/edge counts |
| GET | /graph/neighbourhood/{id} | Get connected nodes |
| POST | /graph/concept | Create concept node |
| DELETE | /graph/concept/{id} | Delete node + edges |
| DELETE | /graph/source | Delete all nodes from source URL |
| GET | /graph/export/json | Export full graph as JSON |
| POST | /ingest/url | Queue a webpage URL |
| POST | /ingest/youtube | Queue YouTube transcript |
| POST | /ingest/pdf | Upload + queue PDF |
| POST | /ingest/text | Queue plain text |
| POST | /ingest/voice | Upload + transcribe voice note |
| POST | /chat | RAG query (returns answer + citations) |
| GET | /digest/today | Today's learning digest |
| GET | /digest/history | Last 30 digests |
| GET | /memory/alerts | Concepts above forgetting threshold |
| POST | /memory/review/{id} | Mark concept as reviewed |
| POST | /gaps | Analyse job description skill gaps |
| GET | /report/weekly | Generate + download weekly PDF |
| WS | /ws | WebSocket for live graph updates |
| POST | /playground | Dev mode prompt testing |

---

## Design System — OBYS Editorial (Option A)

The frontend uses a pure white editorial design inspired by experiment.obys.agency.

**Color palette:**
```css
--bg:      #FAFAF8   /* page background */
--surface: #F2F2F0   /* card/panel background */
--ink:     #0D0D0D   /* primary text */
--ink-60:  rgba(13,13,13,0.6)  /* secondary text */
--ink-30:  rgba(13,13,13,0.3)  /* muted text */
--ink-10:  rgba(13,13,13,0.08) /* borders */
--green:   #00C853   /* live/online indicator ONLY */
--red:     #FF3333   /* error/danger ONLY */
```

**Typography:**
- `Bebas Neue` → all headings (32-120px)
- `Inter 300/400/500` → body text
- `JetBrains Mono` → numbers, data, code

**Rules:**
- NO gradients, NO glow effects, NO box-shadow with color
- NO rounded pills — sharp corners (border-radius: 0 or 2px)
- Borders: 1px solid var(--ink-10) only
- Buttons: flat black filled or outline

---

## Current Status

### ✅ FULLY COMPLETE
- All 5 PRD layers implemented
- All 15 functional requirements (FR-01 to FR-15)
- All 12 non-functional requirements
- 228/228 backend tests passing
- Frontend builds clean (vite build passes)
- 100 sample concepts + 40 edges seeded in Neo4j
- OBYS white editorial redesign applied to index.css
- FloatingGraphPage (3D OBYS-style floating cards) accessible via "3D GRAPH ↗" button
- Docker Compose wiring fixed and working

### ⚠️ KNOWN ISSUES / PENDING
1. **Frontend hero section** — the hero text (giant Bebas Neue headline) and landing page layout may need final visual polish — compare to obys.agency for reference
2. **Carousel3D** — capped at 20 nodes max for performance. If user wants to show all 100+ nodes in the rotating carousel, increase `MAX_VISIBLE` in `Carousel3D.jsx`
3. **FloatingGraphPage CSS** — the `.fg-stage` is a plain div now (removed Framer Motion spring). Works but doesn't have drag-to-scroll — only mouse parallax via mousemove
4. **Whisper** — requires `whisper-cpp` binary to be installed locally on the machine. Voice transcription will fail silently if not installed (by design — no crash)
5. **Weekly PDF** — uses `fpdf2` inside Docker. If report is empty it means no digests exist yet (pipeline hasn't run)
6. **Chrome Extension** — needs to be sideloaded manually (see `docs/extension-sideload.md`)

---

## PRD Functional Requirements Status

| FR | Feature | Status |
|----|---------|--------|
| FR-01 | Webpage capture 60s | ✅ Chrome Extension content.js |
| FR-02 | YouTube >50% transcript | ✅ Chrome Extension + youtube_svc.py |
| FR-03 | PDF ingestion | ✅ pdf_svc.py + desktop_agent.py |
| FR-04 | One-click pause/resume | ✅ popup.js + background.js |
| FR-05 | Nightly AI pipeline | ✅ scheduler.py (APScheduler 23:00) |
| FR-06 | Concept + relationship extraction | ✅ extractor.py + Groq API |
| FR-07 | Neo4j graph storage | ✅ graph_db.py |
| FR-08 | SM-2 forgetting score | ✅ sm2.py |
| FR-09 | ChromaDB vector embeddings | ✅ vector_db.py |
| FR-10 | Conversational RAG query | ✅ rag.py + chat.py router |
| FR-11 | D3.js knowledge graph | ✅ Carousel3D.jsx + FloatingGraphPage.jsx |
| FR-12 | Daily learning digest | ✅ digest_gen.py |
| FR-13 | Fading node alerts | ✅ memory.py + DigestPanel.jsx |
| FR-14 | Domain filtering | ✅ domain_filter.py + domain-filter.js |
| FR-15 | Voice transcription | ✅ whisper_svc.py (requires whisper-cpp binary) |

---

## What Needs Work Next (Priority Order)

1. **Frontend visual polish** — the landing page and main dashboard hero need Bebas Neue large typography applied correctly. Compare screenshots to experiment.obys.agency. The CSS is correct but some components may still have inline styles overriding the design system.

2. **README.md** — needs a complete rewrite with: hero GIF, setup guide, architecture diagram, tech stack badges. This is needed for the GitHub repo and college submission.

3. **Architecture diagram** — needs to be created in Excalidraw and exported as PNG to `docs/architecture.png`

4. **Demo video** — 90-second screen recording: browse article → graph populates → ask question → get cited answer. For YouTube + viva.

5. **Railway deployment** — backend Docker image needs to be deployed to Railway.app. Frontend to Vercel.

6. **Chrome Extension packaging** — zip the `/extension` folder for submission.

---

## Testing

```powershell
cd C:\Users\prasa\Desktop\Mega
python -m pytest backend/tests/ -v
```
Expected: **228 passed**

---

## Git

Repository at: `C:\Users\prasa\Desktop\Mega`
Default branch: `main`
The `.env` files are gitignored — never commit them.

---

*Document generated: 2026-08-01. Prasad, KIT's College of Engineering.*
