# 🧠 Passive Second Brain

> **AI-Powered Automatic Knowledge Graph Construction from Digital Learning Activity**

**B.Tech Final Year Capstone Project** · KIT's College of Engineering, Kolhapur · 2025–2026  
**Domain:** CSE — Artificial Intelligence & Machine Learning  
**Author:** Prasad

---

## One-Line Pitch

> *"An AI system that silently watches how you learn, automatically builds a semantic map of your knowledge, and ensures nothing you ever studied is forgotten — requiring zero effort from the user."*

---

## What It Does

Passive Second Brain runs entirely in the background. You simply live your digital life — browsing articles, watching YouTube videos, opening PDFs — and the system:

1. **Captures** content passively via Chrome Extension and desktop agent
2. **Processes** it nightly using Groq (Llama 3.3 70B) to extract concepts and relationships
3. **Builds** a semantic knowledge graph in Neo4j with 6 typed edge relationships
4. **Computes** an SM-2 forgetting score for every concept node nightly
5. **Surfaces** forgotten knowledge proactively in a beautiful editorial dashboard
6. **Answers** your questions using RAG over your personal graph — not the internet

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Browser Extension | Chrome Extension MV3 (Manifest V3) |
| Backend | FastAPI (Python 3.11) · APScheduler |
| LLM | Groq API — Llama 3.3 70B |
| Knowledge Graph | Neo4j 5.18 |
| Vector Store | ChromaDB (local-first) |
| Frontend | React 18 + Vite |
| Graph Visualisation | D3.js + 3D Carousel + OBYS Floating Cards |
| Animations | Framer Motion |
| Memory Algorithm | SM-2 Spaced Repetition |
| Transcription | Whisper (fully offline) |
| DevOps | Docker Compose |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR DIGITAL LIFE                                          │
│  Browser: Articles · YouTube · PDFs  |  Desktop: PDFs · Voice │
└──────────────────────┬──────────────────────────────────────┘
                       │  passive capture
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  CHROME EXTENSION MV3 + DESKTOP AGENT                       │
│  content.js (60s timer) · background.js · domain filter     │
└──────────────────────┬──────────────────────────────────────┘
                       │  POST /ingest/*
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  FASTAPI BACKEND (port 8090 via Docker)                     │
│  APScheduler → nightly pipeline at 23:00                    │
│  Groq LLM → concept + relationship extraction               │
│  SM-2 → forgetting score per node                           │
└─────────┬──────────────────────────┬────────────────────────┘
          │ Cypher                   │ Embeddings
          ▼                          ▼
┌──────────────────┐       ┌─────────────────────┐
│  Neo4j           │       │  ChromaDB           │
│  Knowledge Graph │       │  Vector Store       │
│  SM-2 scores     │       │  RAG retrieval      │
└────────┬─────────┘       └──────────┬──────────┘
         └──────────┬─────────────────┘
                    │  unified knowledge
                    ▼
┌──────────────────────────────────────────────────────────────┐
│  REACT FRONTEND (port 5173)                                 │
│  D3.js Graph · 3D Floating Cards · Chat (RAG) · Digest      │
│  Gap Detector · Privacy Controls · Weekly Report            │
└──────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- Docker Desktop (running)
- Node.js 20+
- Python 3.11+
- A free Groq API key from [console.groq.com](https://console.groq.com)

---

## Quick Start

### 1. Clone and configure

```bash
git clone <your-repo-url>
cd Mega
cp backend/.env.example backend/.env
```

Edit `backend/.env`:
```
GROQ_API_KEY=your_groq_api_key_here
NEO4J_PASSWORD=YourChosenPassword123
PSB_API_KEY=your-secret-api-key
```

Also create root `.env`:
```
NEO4J_PASSWORD=YourChosenPassword123
```

And `frontend/.env`:
```
VITE_API_BASE_URL=/api
VITE_API_KEY=your-secret-api-key
```

### 2. Start backend services

```bash
docker compose up --build -d
```

Wait ~30 seconds for Neo4j to become healthy. Backend runs at `http://localhost:8090`.

### 3. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

### 4. Seed sample data (first time)

The onboarding wizard will guide you. Or manually:
```bash
curl -X POST http://localhost:8090/graph/seed \
  -H "X-API-Key: your-secret-api-key"
```

### 5. Install Chrome Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder

---

## Features

| Feature | Description |
|---------|-------------|
| 🌐 Passive Web Capture | Extension captures pages you read for 60+ seconds |
| ▶️ YouTube Transcripts | Fetches transcripts for videos watched past 50% |
| 📄 PDF Ingestion | Desktop agent monitors a folder for new PDFs |
| 🎙️ Voice Notes | Record voice notes, transcribed locally via Whisper |
| 🧠 Knowledge Graph | Neo4j graph with 6 semantic edge types |
| 🔁 SM-2 Memory | Ebbinghaus forgetting curve per concept node |
| 💬 RAG Chat | Ask questions, get answers from your own graph |
| 📊 Daily Digest | Auto-generated learning summary each night |
| 🎯 Gap Detector | Paste a job description, see your skill gaps |
| 🔒 Privacy First | All raw data local — only text chunks sent to Groq |
| 3D Graph View | OBYS-inspired floating card animation |

---

## API Reference

Full Swagger docs: `http://localhost:8090/docs`

Key endpoints (all require `X-API-Key` header):

```
POST /ingest/url       — queue a webpage
POST /ingest/youtube   — queue a YouTube video
POST /ingest/pdf       — upload a PDF
POST /chat             — RAG query
GET  /graph/nodes      — list all concepts
GET  /memory/alerts    — fading concepts
GET  /digest/today     — today's learning summary
POST /gaps             — job description gap analysis
GET  /report/weekly    — download weekly PDF
POST /pipeline/trigger — manually run the pipeline
```

---

## Running Tests

```bash
python -m pytest backend/tests/ -v
# Expected: 228 passed
```

---

## Project Structure

```
Mega/
├── backend/          FastAPI backend, all services, prompts, tests
├── extension/        Chrome Extension MV3
├── frontend/         React 18 + Vite + D3.js dashboard
├── docs/             Architecture diagrams, sideload guide
├── data/             Runtime data (gitignored)
├── docker-compose.yml
└── AGENT_HANDOFF.md  Full technical handoff document
```

---

## Differentiation

| Feature | Notion AI | Obsidian | Anki | PSB |
|---------|-----------|----------|------|-----|
| Zero manual input | ✗ | ✗ | ✗ | ✅ |
| Passive browser capture | ✗ | ✗ | ✗ | ✅ |
| Semantic graph | ✗ | ✅ | ✗ | ✅ |
| AI-extracted relationships | ✗ | ✗ | ✗ | ✅ |
| SM-2 forgetting curve | ✗ | ✗ | ✅ | ✅ |
| RAG conversational recall | ✅ | ✗ | ✗ | ✅ |
| Privacy-first / local data | ✗ | ✅ | ✅ | ✅ |

---

## License

MIT — Final Year B.Tech Capstone Project, 2025–2026.
