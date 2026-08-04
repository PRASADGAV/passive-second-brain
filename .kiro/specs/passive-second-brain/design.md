# Design Document — Passive Second Brain

## Overview

Passive Second Brain is an AI-powered personal knowledge management system that automatically builds and maintains a semantic knowledge graph from a user's digital learning activity. The system operates entirely in the background: a Chrome Extension (MV3) and optional Desktop Agent silently capture webpage text, YouTube transcripts, PDFs, and voice notes; a nightly FastAPI pipeline processes the raw captures using Groq's Llama 3.3 70B to extract concepts and relationships; Neo4j stores the resulting typed graph; ChromaDB holds vector embeddings for semantic retrieval; and a React 18 dashboard surfaces everything through an interactive D3.js force-directed canvas, a conversational RAG chat interface, daily digests, spaced-repetition memory alerts, and privacy controls.

All raw data and embeddings remain on the user's local machine. Only anonymised text chunks are sent to the Groq API for inference. The system is decomposed into five discrete, independently deployable layers joined by a FastAPI REST + WebSocket boundary.

---

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4 — React Frontend Dashboard                             │
│  React 18 + Vite · D3.js · Framer Motion · Socket.io client    │
│  Dashboard · Graph · Chat · Digest · Gaps · Privacy             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP REST / WebSocket
┌──────────────────────────▼──────────────────────────────────────┐
│  LAYER 5 / LAYER 2 — FastAPI Backend                            │
│  FastAPI · APScheduler · Groq API (Llama 3.3 70B)              │
│  Routers: ingest · graph · chat · digest · memory · gaps        │
│  Services: scraper · chunker · extractor · resolver · rag …     │
└───────┬──────────────────────────────────┬──────────────────────┘
        │                                  │
┌───────▼───────────┐          ┌───────────▼────────────┐
│  LAYER 3a         │          │  LAYER 3b              │
│  Neo4j            │          │  ChromaDB              │
│  Knowledge Graph  │          │  Vector Embeddings     │
│  Port 7687 (bolt) │          │  Port 8000             │
│  Port 7474 (UI)   │          │                        │
└───────────────────┘          └────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Passive Capture Engine                               │
│  Chrome Extension MV3 · Optional Desktop Agent                  │
│  Webpage · YouTube · PDF (browser) · Voice (dashboard)          │
│  POST /ingest/* ──────────────────────────────────────────────▶ │
└─────────────────────────────────────────────────────────────────┘
```

### Runtime Topology

```
[User Browser]
  └─ Chrome Extension MV3
       ├─ content.js        (page text, reading timer, YT progress)
       ├─ background.js     (service worker, queue, settings sync)
       └─ popup/popup.js    (pause/resume, domain settings)

[User Machine — Docker Compose]
  ├─ neo4j        (localhost:7474 / localhost:7687)
  ├─ chromadb     (localhost:8000)
  └─ backend      (localhost:8080)
       ├─ FastAPI app (main.py)
       ├─ APScheduler (nightly pipeline at 23:00)
       └─ WebSocket manager (/ws)

[Cloud — Optional]
  ├─ Railway      (backend Docker image)
  └─ Vercel       (frontend static build)

[External API]
  └─ Groq API     (text-only inference, anonymised chunks)
```

### Request Flow: Nightly Pipeline

```
APScheduler trigger
  → scheduler.py: fetch all pending CaptureItems
  → For each item:
      scraper/youtube_svc/pdf_svc/whisper_svc → raw_text
      chunker.py → 512-token overlapping chunks
      extractor.py → Groq API → concepts[] + relationships[]
      resolver.py → entity resolution + dedup
      graph_db.py → Neo4j MERGE nodes + edges
      vector_db.py → ChromaDB upsert embeddings
      sm2.py → recompute forget_score for all nodes
  → digest_gen.py → Groq API → DigestEntry
  → WebSocket broadcast: node_added, edge_added, pipeline_status
```

### Request Flow: RAG Chat

```
POST /chat {query}
  → rag.py: ChromaDB similarity search (top 5)
  → rag.py: Neo4j neighbourhood expansion (1-2 hops) on matched nodes
  → Combine + deduplicate context
  → Groq API: generate grounded answer with citations
  → Return {answer, citations[{node_id, source_url}]}
```

---

## Components and Interfaces

### Layer 1 — Passive Capture Engine

#### Chrome Extension (MV3)

| File | Responsibility |
|------|----------------|
| `manifest.json` | Permissions: `activeTab`, `storage`, `scripting`, `tabs`, `webNavigation`. Host permissions: `*://*/*` |
| `content.js` | Injected into every page. Starts a 60 s reading timer. On threshold: `document.body.innerText` extraction, sends to background. Monitors `video.currentTime / video.duration` for YouTube 50% trigger. |
| `background.js` | Service worker. Receives messages from content.js. Applies domain filter, privacy list, pause state. POSTs to `POST /ingest/url` or `POST /ingest/youtube`. Retries on network failure (exponential backoff, max 3 attempts). |
| `popup/popup.js` | Reads/writes pause state and custom threshold from `chrome.storage.local`. Displays badge indicating paused/active. |
| `utils/domain-filter.js` | `isBlocked(url): boolean` — checks against hardcoded + user-configured blocked domain list. |
| `utils/youtube.js` | `getVideoProgress(): {videoId, percent, duration}` — reads YT player API or DOM. |

#### Desktop Agent (Optional)

A Python watchdog process (`desktop_agent.py`) monitors a user-configured directory for new `.pdf` files using `watchdog`. On detection, it calls `PyMuPDF` to extract text page by page and POSTs to `POST /ingest/pdf`.

---

### Layer 2 — Nightly AI Processing Pipeline

#### Services

| Service | Interface |
|---------|-----------|
| `scraper.py` | `scrape(url: str) -> str` — fetches HTML, applies trafilatura for boilerplate removal |
| `youtube_svc.py` | `get_transcript(video_id: str) -> str` — youtube-transcript-api |
| `pdf_svc.py` | `extract_pdf(path_or_url: str) -> List[str]` — PyMuPDF, one string per page |
| `whisper_svc.py` | `transcribe(audio_path: str) -> str` — whisper.cpp subprocess call |
| `chunker.py` | `chunk(text: str, max_tokens=512, overlap=50) -> List[str]` |
| `extractor.py` | `extract_concepts(chunk: str) -> ExtractionResult` — Groq API call |
| `resolver.py` | `resolve(concepts: List[RawConcept]) -> List[ResolvedConcept]` — string norm + semantic dedup |
| `graph_db.py` | `upsert_node(node: ConceptNode)`, `upsert_edge(edge: Edge)`, `delete_node(id)`, `delete_by_source(url)`, `get_neighbourhood(id, hops=2)` |
| `vector_db.py` | `upsert_embedding(concept_id, text)`, `similarity_search(query, top_k=5) -> List[str]` |
| `rag.py` | `query(q: str) -> RAGResult` — hybrid retrieval + Groq generation |
| `sm2.py` | `compute_forget_score(node: ConceptNode) -> float`, `update_sm2(node, reviewed=True) -> ConceptNode` |
| `scheduler.py` | APScheduler `CronTrigger(hour=23)` — orchestrates full pipeline run |
| `digest_gen.py` | `generate_digest(stats: PipelineStats) -> DigestEntry` — Groq API call |

#### LLM Prompts

**`prompts/extract.py`** — Concept extraction system prompt:

```
You are a knowledge extraction engine. Given a text passage, extract all significant concepts
and entities. Return ONLY a valid JSON object with the following structure:
{
  "concepts": [
    {
      "name": "<concept name, max 200 chars>",
      "domain": "<domain string>",
      "summary": "<brief summary, max 500 chars>",
      "confidence": <float 0.0-1.0>
    }
  ]
}
Extract between 3 and 15 concepts. Assign confidence based on how clearly the concept is
discussed. Return NOTHING except the JSON object.
```

**`prompts/gaps.py`** — Relationship extraction system prompt:
```
You are a knowledge graph relationship extractor. Given a list of concept names extracted from
the same text, identify semantic relationships between pairs. Return ONLY a valid JSON object:
{
  "relationships": [
    {
      "from": "<concept name>",
      "to": "<concept name>",
      "type": "<one of: IS_PREREQUISITE_FOR|IS_SUBSET_OF|EXTENDS|CONTRADICTS|IS_USED_IN|CO_OCCURS_WITH>",
      "confidence": <float 0.0-1.0>
    }
  ]
}
Only use the six specified relationship types. Return NOTHING except the JSON object.
```

---

### Layer 3 — Semantic Knowledge Graph + Memory

#### Neo4j Schema

```cypher
// Node
(:Concept {
  concept_id: String,   // UUID
  name: String,
  domain: String,
  summary: String,
  source_url: String,
  created_at: DateTime,
  last_seen: DateTime,
  ease_factor: Float,   // 1.3 – 5.0
  rep_interval: Integer,
  rep_count: Integer,
  forget_score: Float   // 0.0 – 1.0
})

// Edge (six label types)
(a:Concept)-[:IS_PREREQUISITE_FOR {confidence: Float, created_at: DateTime}]->(b:Concept)
(a:Concept)-[:IS_SUBSET_OF        {confidence: Float, created_at: DateTime}]->(b:Concept)
(a:Concept)-[:EXTENDS             {confidence: Float, created_at: DateTime}]->(b:Concept)
(a:Concept)-[:CONTRADICTS         {confidence: Float, created_at: DateTime}]->(b:Concept)
(a:Concept)-[:IS_USED_IN          {confidence: Float, created_at: DateTime}]->(b:Concept)
(a:Concept)-[:CO_OCCURS_WITH      {confidence: Float, created_at: DateTime}]->(b:Concept)

// Indexes
CREATE INDEX concept_id_index FOR (c:Concept) ON (c.concept_id);
CREATE INDEX concept_name_index FOR (c:Concept) ON (c.name);
CREATE INDEX concept_domain_index FOR (c:Concept) ON (c.domain);
CREATE INDEX concept_forget_score_index FOR (c:Concept) ON (c.forget_score);
```

#### ChromaDB Collection

Collection name: `psb_concepts`
Document ID: `concept_id` (UUID string)
Document text: `"{name}. {summary}"` (concatenated for embedding)
Metadata: `{concept_id, domain, source_url, forget_score}`

#### SM-2 Forgetting Score Algorithm

```python
import math
from datetime import datetime

def compute_forget_score(node) -> float:
    days_since_seen = (datetime.utcnow() - node.last_seen).days
    retention = math.exp(-days_since_seen / (node.rep_interval * node.ease_factor))
    forget_score = 1 - retention  # 0=fresh, 1=forgotten
    return round(forget_score, 4)

def update_sm2_on_review(node, quality: int = 4) -> dict:
    """
    quality: 0-5 (SM-2 grade). 4 = correct recall, 5 = perfect.
    Returns updated {ease_factor, rep_interval, rep_count}.
    """
    q = quality
    ef = node.ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    ef = max(1.3, min(5.0, ef))
    if q < 3:
        interval = 1
        rep_count = 0
    elif node.rep_count == 0:
        interval = 1
        rep_count = 1
    elif node.rep_count == 1:
        interval = 6
        rep_count = 2
    else:
        interval = round(node.rep_interval * ef)
        rep_count = node.rep_count + 1
    return {"ease_factor": ef, "rep_interval": interval, "rep_count": rep_count}
```

---

### Layer 4 — React Frontend Dashboard

#### Component Tree

```
App.jsx
├── pages/Onboarding.jsx       (first-launch wizard)
├── pages/Dashboard.jsx        (main layout)
│   ├── components/Graph/
│   │   ├── GraphCanvas.jsx    (D3.js force simulation, WebSocket-driven)
│   │   ├── NodeDetail.jsx     (side panel for selected node)
│   │   └── GraphControls.jsx  (zoom, filter, domain toggle)
│   ├── components/Chat/
│   │   ├── ChatPanel.jsx      (session history, input box)
│   │   └── ChatMessage.jsx    (message + citations renderer)
│   ├── components/Digest/
│   │   ├── DigestPanel.jsx    (today's digest + history tabs)
│   │   └── AlertCard.jsx      (fading concept card with forget_score bar)
│   ├── components/Input/
│   │   └── InputPanel.jsx     (manual URL/text/voice input)
│   ├── components/Gaps/
│   │   └── GapAnalyser.jsx    (job description textarea + gap report)
│   └── components/Privacy/
│       └── PrivacyPanel.jsx   (captured items list + delete controls)
└── pages/WeeklyReport.jsx     (PDF preview + download)
```

#### Key Hooks

| Hook | Purpose |
|------|---------|
| `useGraph.js` | Fetches `GET /graph/nodes`, manages D3 simulation data, subscribes to `node_added` / `edge_added` WebSocket events |
| `useWebSocket.js` | Establishes `WS /ws`, dispatches events to registered handlers, handles reconnection |
| `useChat.js` | Manages session message history, calls `POST /chat`, appends responses with citations |

#### D3.js Force Graph

```javascript
// GraphCanvas.jsx — core simulation setup
const simulation = d3.forceSimulation(nodes)
  .force("link",    d3.forceLink(links).id(d => d.concept_id).distance(80))
  .force("charge",  d3.forceManyBody().strength(-200))
  .force("center",  d3.forceCenter(width / 2, height / 2))
  .force("collide", d3.forceCollide(d => nodeRadius(d) + 4));

// Node radius proportional to edge count + rep_count
function nodeRadius(d) {
  return 6 + Math.sqrt(d.edge_count + d.rep_count) * 1.5;
}

// Colour by domain
const colorScale = d3.scaleOrdinal(d3.schemeTableau10);
const nodeColor = d => colorScale(d.domain);
```

---

### Layer 5 — Extras

#### Weekly PDF Report (`GET /report/weekly`)

Uses `reportlab` or `fpdf2` to generate a structured PDF containing:
- Bar chart of new concepts per day (7 days)
- Top 10 concepts by edge count
- Domains covered (pie chart via matplotlib inline image)
- Concepts that crossed the forgetting threshold
- File name: `psb-weekly-report-YYYY-MM-DD.pdf`

#### Graph Export (`GET /export/json`)

Serialises all nodes and edges from Neo4j into:
```json
{
  "exported_at": "2025-01-15T10:00:00Z",
  "nodes": [...ConceptNode objects...],
  "edges": [...Edge objects with source_id, target_id, type, confidence...]
}
```
File name: `psb-graph-export-YYYY-MM-DD.json`

#### Prompt Playground (`POST /playground`)

Available only when `DEVELOPER_MODE=true` in environment. Accepts `{prompt, sample_text}`, calls Groq API directly, returns `{raw_response, token_usage, latency_ms}`. Persisted prompts stored in `prompts/extract.py`, `prompts/digest.py`, `prompts/gaps.py`.

#### Pipeline Status & Manual Trigger

- `GET /pipeline/status` — returns `{status: "idle"|"running"|"failed", last_run, items_processed, error}`
- `POST /pipeline/trigger` — immediately enqueues a pipeline run outside the scheduled window

---

## Data Models

### `models/schemas.py`

```python
from pydantic import BaseModel, Field, UUID4
from datetime import datetime, date
from enum import Enum
from typing import Optional, List

class SourceType(str, Enum):
    webpage = "webpage"
    youtube = "youtube"
    pdf     = "pdf"
    voice   = "voice"
    text    = "text"

class CaptureStatus(str, Enum):
    pending    = "pending"
    processing = "processing"
    completed  = "completed"
    failed     = "failed"

class EdgeType(str, Enum):
    IS_PREREQUISITE_FOR = "IS_PREREQUISITE_FOR"
    IS_SUBSET_OF        = "IS_SUBSET_OF"
    EXTENDS             = "EXTENDS"
    CONTRADICTS         = "CONTRADICTS"
    IS_USED_IN          = "IS_USED_IN"
    CO_OCCURS_WITH      = "CO_OCCURS_WITH"

class CaptureItem(BaseModel):
    id:           UUID4
    source_type:  SourceType
    source_url:   str
    raw_text:     str
    captured_at:  datetime
    status:       CaptureStatus = CaptureStatus.pending
    domain:       Optional[str] = None

class ConceptNode(BaseModel):
    concept_id:   str = Field(..., description="UUID string")
    name:         str = Field(..., max_length=200)
    domain:       str
    summary:      str = Field(..., max_length=500)
    source_url:   str
    created_at:   datetime
    last_seen:    datetime
    ease_factor:  float = Field(2.5, ge=1.3, le=5.0)
    rep_interval: int   = Field(1, ge=1)
    rep_count:    int   = Field(0, ge=0)
    forget_score: float = Field(0.0, ge=0.0, le=1.0)

class Edge(BaseModel):
    source_id:  str
    target_id:  str
    type:       EdgeType
    confidence: float = Field(..., ge=0.0, le=1.0)
    created_at: datetime

class DigestEntry(BaseModel):
    date:               date
    new_concepts_count: int
    new_edges_count:    int
    domains_covered:    List[str]
    fading_concepts:    List[str]   # list of concept_ids
    summary_text:       str

class RAGResult(BaseModel):
    answer:    str
    citations: List[dict]           # [{node_id, name, source_url}]

class GapReport(BaseModel):
    present_skills: List[dict]      # [{skill, concept_id, forget_score}]
    missing_skills: List[str]
```

---

## API Design

### Router Overview

| Router File | Prefix | Purpose |
|-------------|--------|---------|
| `ingest.py` | `/ingest` | Content ingestion endpoints |
| `graph.py` | `/graph` | Graph CRUD and traversal |
| `chat.py` | `/chat` | RAG query |
| `digest.py` | `/digest` | Daily digest access |
| `memory.py` | `/memory` | Forgetting threshold alerts |
| `gaps.py` | `/gaps` | Gap analysis |

### Full Endpoint Table

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/ingest/url` | Scrape and queue webpage | API key |
| POST | `/ingest/youtube` | Fetch transcript and queue | API key |
| POST | `/ingest/pdf` | Extract and queue PDF (multipart) | API key |
| POST | `/ingest/text` | Queue plain text | API key |
| GET | `/graph/nodes` | List all concept nodes | API key |
| POST | `/graph/concept` | Create concept node | API key |
| DELETE | `/graph/concept/{id}` | Delete node + all edges | API key |
| DELETE | `/graph/source/{url}` | Delete all nodes from source | API key |
| GET | `/graph/neighbourhood/{id}` | Get connected nodes (1-2 hops) | API key |
| GET | `/graph/stats` | Node/edge counts + growth metrics | API key |
| POST | `/chat` | RAG query | API key |
| GET | `/digest/today` | Latest digest entry | API key |
| GET | `/digest/history` | Last 30 digest entries | API key |
| GET | `/memory/alerts` | Nodes above forgetting threshold | API key |
| POST | `/gaps` | Gap analysis from job description | API key |
| GET | `/report/weekly` | Generate and return weekly PDF | API key |
| GET | `/export/json` | Export full graph as JSON | API key |
| GET | `/pipeline/status` | Latest pipeline run status | Public |
| POST | `/pipeline/trigger` | Manually trigger pipeline | API key |
| GET | `/health` | Health check | Public |
| WS | `/ws` | WebSocket for live updates | None |

### Request / Response Examples

**POST `/ingest/url`**
```json
Request:  { "url": "https://example.com/article" }
Response: { "item_id": "uuid", "status": "pending", "queued_at": "ISO datetime" }
```

**POST `/chat`**
```json
Request:  { "query": "What is backpropagation?", "session_id": "uuid" }
Response: {
  "answer": "Backpropagation is...",
  "citations": [
    {"node_id": "uuid", "name": "Backpropagation", "source_url": "https://..."}
  ]
}
```

**POST `/gaps`**
```json
Request:  { "job_description": "We need expertise in PyTorch, transformers..." }
Response: {
  "present_skills": [{"skill": "PyTorch", "concept_id": "uuid", "forget_score": 0.12}],
  "missing_skills": ["Kubernetes", "Apache Kafka"]
}
```

### WebSocket Event Schema

```json
// node_added
{ "event": "node_added", "data": { "node": { ...ConceptNode } } }

// edge_added
{ "event": "edge_added", "data": { "edge": { ...Edge }, "source_id": "uuid", "target_id": "uuid" } }

// pipeline_status
{ "event": "pipeline_status", "data": { "status": "running", "progress": 0.45, "items_processed": 23 } }
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After the prework analysis, the following consolidations were made:
- Properties 1.4 (blocked domain skip) and 1.5 (private page skip) are merged into a single "capture exclusion" property, since both test the same invariant: certain pages must never be captured regardless of reading time.
- Properties 1.6 / 2.4 (pause = no capture for any content type) are merged into one universal pause invariant.
- Property 13.4 (forget_score in [0,1]) is subsumed by Property 13.2 (formula correctness), so it is removed.
- Properties 18.3 and 18.4 (node deletion and source deletion) each provide unique value since they test different deletion scopes; retained separately.
- Properties 27.3 and 27.4 (422 / 404 responses) are consolidated into one "API validation" property.

---

### Property 1: Reading-Time Threshold Capture Trigger

*For any* webpage and any (elapsed_time, threshold) pair, the Extension SHALL trigger content extraction if and only if elapsed_time exceeds threshold. For any elapsed time at or below the threshold, no extraction occurs.

**Validates: Requirements 1.1, 1.3**

---

### Property 2: Capture Exclusion for Blocked and Private Pages

*For any* page URL that either matches a Blocked_Domain rule or has been marked as a Private_Page, and *for any* elapsed reading time (including values far exceeding the threshold), the Extension SHALL not capture any content from that page.

**Validates: Requirements 1.4, 1.5**

---

### Property 3: Universal Pause Invariant

*For any* content type (webpage, YouTube, PDF, voice) and *for any* source URL or file path, while the user's tracking state is paused, the Capture_Engine SHALL produce zero new CaptureItems in the queue regardless of reading time, video progress, or file system events.

**Validates: Requirements 1.6, 2.4, 3.3, 6.2**

---

### Property 4: YouTube 50% Transcript Trigger

*For any* YouTube video of duration D and *for any* playback position P, the Extension SHALL trigger transcript retrieval if and only if P / D > 0.5. For P / D ≤ 0.5, no transcript retrieval is triggered.

**Validates: Requirements 2.1**

---

### Property 5: PDF Page-by-Page Completeness

*For any* PDF document containing N pages where N ≥ 1, and assuming no page raises an extraction exception, the pdf_svc SHALL return a list of exactly N non-empty strings, one per page, in page order.

**Validates: Requirements 3.1, 3.2**

---

### Property 6: PDF Partial Failure Resilience

*For any* PDF document where page K fails during extraction, the service SHALL still extract and return all pages outside of page K, and SHALL log exactly one failure entry containing the page number K.

**Validates: Requirements 3.5**

---

### Property 7: Voice Note Privacy Invariant

*For any* voice note recording session, the transcription pipeline SHALL invoke only the local whisper.cpp subprocess and SHALL make zero outbound network calls that carry audio data or transcript text to any external server.

**Validates: Requirements 4.3**

---

### Property 8: Domain Tag Membership

*For any* captured item and *for any* non-empty list of user-defined learning domains, the Capture_Engine SHALL assign a domain tag that is a member of the configured domain list. No domain tag outside the configured list shall be assigned to a classified item.

**Validates: Requirements 5.2**

---

### Property 9: Text Chunking Token Bound

*For any* input text of arbitrary length, the chunker SHALL produce a list of chunks such that every chunk contains at most 512 tokens, adjacent chunks overlap by the configured overlap count, and the concatenation of all chunks (de-overlapped) covers the full input text without omission.

**Validates: Requirements 8.2**

---

### Property 10: Concept Extraction Response Schema Validity

*For any* valid JSON string returned by the Groq extraction API, the parser SHALL produce a list of concept objects where every object contains non-empty `name`, non-empty `domain`, non-empty `summary`, and a `confidence` value in the closed interval [0.0, 1.0].

**Validates: Requirements 8.3, 8.4**

---

### Property 11: Relationship Type Validation

*For any* relationship object returned by the LLM whose `type` field is not one of the six valid EdgeType values {IS_PREREQUISITE_FOR, IS_SUBSET_OF, EXTENDS, CONTRADICTS, IS_USED_IN, CO_OCCURS_WITH}, the Pipeline SHALL discard that relationship and SHALL not insert a corresponding Edge into the Knowledge_Graph.

**Validates: Requirements 9.3**

---

### Property 12: Entity Resolution Idempotence

*For any* concept name C and its known semantic equivalent C' (e.g., "ML" and "Machine Learning"), running entity resolution against a graph that already contains a node for C SHALL resolve C' to the same concept_id as C, and SHALL not create a new node for C'.

**Validates: Requirements 10.2, 10.5**

---

### Property 13: Concept Merge Preserves All Relationships

*For any* two concepts A and B that are resolved as duplicates, where A has edge set E_A and B has edge set E_B and they have source URL sets S_A and S_B respectively, the merged node SHALL have edge set E_A ∪ E_B and source URL set S_A ∪ S_B, with no edges or sources lost.

**Validates: Requirements 10.3**

---

### Property 14: Node Upsert Does Not Duplicate

*For any* concept that already exists in the Knowledge_Graph, processing the same concept again (from the same or a new source) SHALL update the existing node's `last_seen` and relevant properties without creating a second node sharing the same name.

**Validates: Requirements 11.5**

---

### Property 15: ChromaDB Embedding Round-Trip

*For any* concept_id that has been upserted into ChromaDB, a similarity search query using the node's own name and summary as the query string SHALL return that concept_id in the top results, confirming the embedding was stored and is retrievable.

**Validates: Requirements 12.1, 12.2, 12.3**

---

### Property 16: SM-2 Forget Score Formula Correctness

*For any* valid triple (ease_factor ef ∈ [1.3, 5.0], rep_interval ri ≥ 1, days_since_seen d ≥ 0), the `compute_forget_score` function SHALL return exactly `round(1 - exp(-d / (ri * ef)), 4)`, and the result SHALL always lie in the closed interval [0.0, 1.0].

**Validates: Requirements 13.2, 13.4**

---

### Property 17: RAG Citations Non-Empty for Found Knowledge

*For any* query Q for which the hybrid retrieval pipeline returns at least one matching concept from ChromaDB or Neo4j, the API response SHALL include a non-empty `citations` list where each citation contains a valid `node_id` and `source_url`.

**Validates: Requirements 16.4**

---

### Property 18: Node Deletion Completeness

*For any* concept_id that exists in the Knowledge_Graph, after a delete operation on that concept_id, the node SHALL be absent from both Neo4j (no node with that concept_id) and ChromaDB (no document with that concept_id), and every Edge that referenced that concept_id as either source or target SHALL also be absent from Neo4j.

**Validates: Requirements 18.3**

---

### Property 19: Source Deletion Cascade

*For any* source URL for which N concept nodes were derived, after a delete-by-source operation on that URL, all N nodes SHALL be absent from Neo4j and ChromaDB, and all edges connected to any of those N nodes SHALL also be absent.

**Validates: Requirements 18.4**

---

### Property 20: Skill Presence Classification Correctness

*For any* list of extracted skills S from a job description, and *for any* known graph state G, the gap analysis SHALL correctly classify each skill s ∈ S as "present" if and only if a ConceptNode with a semantically matching name exists in G, and "missing" otherwise. No skill shall appear in both lists simultaneously.

**Validates: Requirements 19.3**

---

### Property 21: Weekly Report Statistics Accuracy

*For any* 7-day window with a known set of M node additions and K edge additions, the compiled report SHALL report exactly M new concepts and exactly K new edges for that window, with no under-count or over-count.

**Validates: Requirements 20.2**

---

### Property 22: API Input Validation — 422 and 404 Responses

*For any* API request that contains invalid or missing required parameters, the API SHALL return HTTP status 422 with a non-empty validation error message. *For any* API request that references a concept_id or resource that does not exist in the graph, the API SHALL return HTTP status 404.

**Validates: Requirements 27.3, 27.4**

---

## Error Handling Strategy

### Layered Error Boundaries

```
Extension (content.js / background.js)
  └── try/catch around all extraction calls
       ├── On failure: chrome.runtime.sendMessage({type: "CAPTURE_FAILED", url, error})
       └── background.js logs to chrome.storage.local["error_log"]

FastAPI Routers
  └── Global exception handler in main.py
       ├── ValidationError → 422 with field-level detail
       ├── Neo4jError → 503 with retry-after hint
       ├── GroqAPIError → 502 with error message
       └── Unexpected → 500 with request_id for log correlation

Pipeline (scheduler.py)
  └── Per-item try/except
       ├── On item failure: mark CaptureItem.status = "failed", log item_id + trace
       └── Continue to next item (never abort full batch on single item failure)

Neo4j writes (graph_db.py)
  └── Exponential backoff retry (3 attempts, delays: 1s, 2s, 4s)
       └── On final failure: preserve item in failed_writes queue for next run

Groq API calls (extractor.py, digest_gen.py)
  └── Retry on HTTP 429 (rate limit) with 5s back-off
       └── On malformed JSON: log chunk_id, skip chunk, continue

ChromaDB writes (vector_db.py)
  └── Retry once on connection error
       └── On final failure: log concept_id, continue (embedding regenerated next run)
```

### Error Log Schema

```python
{
    "timestamp": "ISO datetime",
    "level": "ERROR | WARNING | INFO",
    "component": "pipeline | extension | api | graph_db | vector_db",
    "item_id": "UUID or null",
    "message": "Human-readable description",
    "trace": "Full stack trace (errors only)"
}
```

### Deletion Partial Failure Handling

If node deletion from Neo4j succeeds but ChromaDB deletion fails (or vice versa):
1. API returns HTTP 207 Multi-Status with a body listing which stores succeeded and which failed.
2. Dashboard shows "Partial deletion — X items not removed" alert (not a success confirmation).
3. Items remain in an inconsistent state flagged in the error log for manual resolution.

---

## Performance Considerations

### Pipeline Throughput

- **Target:** 50 items in ≤ 5 minutes (6 items/minute).
- **Chunking parallelism:** `asyncio.gather` processes all chunks of a single item concurrently.
- **Groq API concurrency:** Up to 5 concurrent API calls using `asyncio.Semaphore(5)` to respect rate limits.
- **Neo4j batch writes:** Use `UNWIND` Cypher clause to write up to 50 nodes in a single transaction.
- **ChromaDB batch upsert:** Use `collection.upsert(ids=[...], documents=[...])` for bulk embedding storage.
- **Performance warning:** If elapsed time exceeds 300s, log `PIPELINE_SLOW_WARNING` with batch size and elapsed time.

### Graph Query Performance

- Neo4j indexes on `concept_id`, `name`, `domain`, `forget_score` ensure sub-2s queries for graphs up to 10,000 nodes.
- Neighbourhood queries limited to 2 hops to prevent exponential expansion.
- `LIMIT 500` on `GET /graph/nodes` for initial load; pagination via `skip` / `limit` query params.

### Frontend Rendering

- D3.js simulation runs on a Web Worker to avoid blocking the main thread.
- For graphs > 500 nodes, enable level-of-detail: hide edge labels, reduce node radius, use canvas renderer instead of SVG.
- WebSocket events are batched client-side: accumulate events for 200ms before applying to simulation.
- `React.memo` and `useMemo` on `ChatMessage`, `AlertCard`, `NodeDetail` to prevent unnecessary re-renders.

### Hybrid RAG Latency

- ChromaDB similarity search: ~50ms for 10,000 embeddings.
- Neo4j neighbourhood query: ~100ms for 2-hop expansion.
- Groq API inference (Llama 3.3 70B): ~1-2s.
- Total budget: ≤ 3s. Context window limited to 8 retrieved chunks to keep prompt size manageable.

---

## Security Design

### API Authentication

All non-public endpoints require an `X-API-Key` header. The key is:
- Stored in `.env` as `PSB_API_KEY` (never committed to Git).
- Validated in a FastAPI dependency `verify_api_key(request)` applied globally via `app.dependency_overrides`.
- Public endpoints: `GET /health`, `GET /pipeline/status`, `WS /ws` (read-only events).

### Secrets Management

```
# .env.example (committed — no real values)
GROQ_API_KEY=your_groq_api_key_here
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password_here
PSB_API_KEY=your_local_api_key_here
DEVELOPER_MODE=false
```

- `.env` is in `.gitignore`.
- Frontend (`src/api/client.js`) reads `VITE_API_BASE_URL` and `VITE_API_KEY` from Vite's `import.meta.env` — never hardcoded.
- Groq API receives only text chunks — no URLs, usernames, or file paths included in prompts.

### Data Locality

- Neo4j and ChromaDB run inside Docker on `localhost` with no external port exposure by default.
- Docker Compose network: `psb_internal` (bridge, not published to host except on configured ports).
- No raw captured text is logged to stdout or external monitoring services.
- Voice recordings stored in `data/voice/` with owner-only file permissions (chmod 600).

### Input Validation

- All ingest endpoints validate URLs using Pydantic's `AnyHttpUrl` type.
- Text inputs are truncated to 1MB before processing to prevent memory exhaustion.
- Job description input for gap analysis sanitised (strip HTML tags) before LLM submission.
- Extension content script enforces `max_text_length = 100_000` characters per page to cap memory usage.

### Extension Permissions Minimisation

Permissions requested in `manifest.json`:
- `activeTab` — read current tab URL and content only when triggered
- `storage` — persist settings and pause state locally
- `scripting` — inject content.js
- `webNavigation` — detect page load complete event
- No `history`, `bookmarks`, `cookies`, `identity`, or `geolocation` permissions

---

## Testing Strategy

### Dual Testing Approach

The system uses both **unit/property-based tests** for pure logic and **integration tests** for infrastructure wiring. Together they provide comprehensive coverage.

### Property-Based Testing

Library: **[Hypothesis](https://hypothesis.readthedocs.io/)** (Python) — industry-standard PBT library.

Minimum 100 iterations per property test. Each test is tagged with a comment referencing the design property.

| Property | Test File | Hypothesis Strategy |
|----------|-----------|---------------------|
| Property 1: Reading-time threshold trigger | `tests/test_capture.py` | `st.integers(0,300)` for elapsed + threshold |
| Property 2: Capture exclusion | `tests/test_capture.py` | `st.sampled_from(blocked_domains)` |
| Property 3: Universal pause invariant | `tests/test_capture.py` | `st.one_of(st.text(), st.just(None))` |
| Property 4: YouTube 50% trigger | `tests/test_youtube.py` | `st.floats(0, 10000)` for D and P |
| Property 5: PDF page completeness | `tests/test_pdf.py` | `st.integers(1, 100)` for N pages |
| Property 6: PDF partial failure resilience | `tests/test_pdf.py` | `st.integers(1, 50)` for failure page K |
| Property 7: Voice privacy invariant | `tests/test_whisper.py` | Mock network layer + Hypothesis |
| Property 8: Domain tag membership | `tests/test_filter.py` | `st.lists(st.text(), min_size=1)` |
| Property 9: Text chunking token bound | `tests/test_chunker.py` | `st.text(min_size=0, max_size=50000)` |
| Property 10: Extraction schema validity | `tests/test_extractor.py` | `st.from_type(ExtractionResult)` |
| Property 11: Relationship type validation | `tests/test_extractor.py` | `st.text()` for relationship type |
| Property 12: Entity resolution idempotence | `tests/test_resolver.py` | `st.text()` for concept names |
| Property 13: Merge preserves relationships | `tests/test_resolver.py` | `st.lists(st.builds(Edge))` |
| Property 14: Upsert no duplicate | `tests/test_graph_db.py` | `st.builds(ConceptNode)` |
| Property 15: ChromaDB embedding round-trip | `tests/test_vector_db.py` | `st.builds(ConceptNode)` |
| Property 16: SM-2 formula correctness | `tests/test_sm2.py` | `st.floats(1.3,5.0)`, `st.integers(1,365)`, `st.integers(0,730)` |
| Property 17: RAG citations non-empty | `tests/test_rag.py` | Mock retrieval + `st.text()` for query |
| Property 18: Node deletion completeness | `tests/test_graph_db.py` | `st.builds(ConceptNode)` with edges |
| Property 19: Source deletion cascade | `tests/test_graph_db.py` | `st.integers(1, 20)` for N derived nodes |
| Property 20: Skill classification correctness | `tests/test_gaps.py` | `st.lists(st.text())` for skills |
| Property 21: Weekly report accuracy | `tests/test_digest_gen.py` | `st.integers(0,500)` for mutation counts |
| Property 22: API validation responses | `tests/test_api.py` | `st.fixed_dictionaries({...invalid...})` |

Tag format: `# Feature: passive-second-brain, Property {N}: {property_text}`

### Unit Tests

- `tests/test_schemas.py` — Pydantic model validation, field bounds, enum values
- `tests/test_domain_filter.py` — isBlocked() with specific known blocked and allowed domains
- `tests/test_sm2.py` — SM-2 update logic with specific quality grades 0-5
- `tests/test_digest_gen.py` — Digest structure with known pipeline stats
- `tests/test_api.py` — 422/404 for specific invalid inputs; 200 for valid inputs

### Integration Tests

- `tests/integration/test_pipeline.py` — Full pipeline run with 50-item queue; verify items_processed and elapsed time
- `tests/integration/test_neo4j.py` — 10,000-node load test; verify query < 2s
- `tests/integration/test_chromadb.py` — Embedding upsert and retrieval against running ChromaDB instance
- `tests/integration/test_rag.py` — End-to-end RAG with real Neo4j + ChromaDB; verify response < 3s
- `tests/integration/test_websocket.py` — Connect to WS /ws; trigger pipeline; verify node_added events received

### Frontend Tests

- **Vitest + React Testing Library** for component unit tests
- `tests/frontend/Graph.test.jsx` — GraphCanvas renders correct node count; node click shows NodeDetail
- `tests/frontend/Chat.test.jsx` — ChatPanel submits query; displays response + citations
- `tests/frontend/Privacy.test.jsx` — Delete button calls DELETE endpoint; item removed from list
- **Playwright** for E2E: onboarding flow, dashboard load, chat round-trip

---

## Docker Compose Configuration

```yaml
# docker-compose.yml
version: "3.9"

services:
  neo4j:
    image: neo4j:5.18-community
    ports:
      - "7474:7474"   # Browser UI
      - "7687:7687"   # Bolt protocol
    environment:
      NEO4J_AUTH: "neo4j/${NEO4J_PASSWORD}"
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
    networks:
      - psb_internal

  chromadb:
    image: chromadb/chroma:latest
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/.chroma
    networks:
      - psb_internal

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    env_file:
      - ./backend/.env
    depends_on:
      - neo4j
      - chromadb
    volumes:
      - ./data:/app/data          # CaptureItems, voice recordings, digests
      - ./backend/prompts:/app/prompts  # Editable prompts persisted
    networks:
      - psb_internal

volumes:
  neo4j_data:
  neo4j_logs:
  chroma_data:

networks:
  psb_internal:
    driver: bridge
```

---

## Folder Structure

```
passive-second-brain/
├── extension/
│   ├── manifest.json             # MV3 manifest, permissions declaration
│   ├── background.js             # Service worker: queue, domain filter, POST to API
│   ├── content.js                # Reading timer, text extraction, YT progress monitor
│   ├── popup/
│   │   ├── popup.html            # Pause/resume toggle + status badge
│   │   └── popup.js              # Reads/writes chrome.storage.local
│   └── utils/
│       ├── domain-filter.js      # isBlocked(url): boolean
│       └── youtube.js            # getVideoProgress(): {videoId, percent, duration}
├── backend/
│   ├── main.py                   # FastAPI app init, router registration, WS manager
│   ├── requirements.txt
│   ├── .env.example
│   ├── routers/
│   │   ├── ingest.py             # /ingest/* endpoints
│   │   ├── graph.py              # /graph/* endpoints
│   │   ├── chat.py               # POST /chat
│   │   ├── digest.py             # /digest/* endpoints
│   │   ├── memory.py             # GET /memory/alerts
│   │   └── gaps.py               # POST /gaps
│   ├── services/
│   │   ├── scraper.py            # trafilatura HTML → clean text
│   │   ├── youtube_svc.py        # youtube-transcript-api wrapper
│   │   ├── pdf_svc.py            # PyMuPDF page extraction
│   │   ├── whisper_svc.py        # whisper.cpp subprocess
│   │   ├── chunker.py            # 512-token overlapping chunker
│   │   ├── extractor.py          # Groq concept + relationship extraction
│   │   ├── resolver.py           # Entity resolution + dedup
│   │   ├── graph_db.py           # Neo4j CRUD + neighbourhood queries
│   │   ├── vector_db.py          # ChromaDB upsert + similarity search
│   │   ├── rag.py                # Hybrid RAG retrieval + Groq generation
│   │   ├── sm2.py                # SM-2 forget_score + update logic
│   │   ├── scheduler.py          # APScheduler CronTrigger(hour=23) pipeline
│   │   └── digest_gen.py         # Daily digest Groq generation
│   ├── models/
│   │   └── schemas.py            # Pydantic models for all data structures
│   └── prompts/
│       ├── extract.py            # Concept + relationship extraction system prompts
│       ├── digest.py             # Daily digest generation prompt
│       └── gaps.py               # Gap analysis extraction prompt
├── frontend/
│   └── src/
│       ├── App.jsx               # Router setup, global layout
│       ├── main.jsx              # React DOM render entry
│       ├── components/
│       │   ├── Graph/
│       │   │   ├── GraphCanvas.jsx   # D3 force simulation, pan/zoom/drag
│       │   │   ├── NodeDetail.jsx    # Side panel for clicked node
│       │   │   └── GraphControls.jsx # Zoom buttons, domain filter toggles
│       │   ├── Chat/
│       │   │   ├── ChatPanel.jsx     # Session history + input
│       │   │   └── ChatMessage.jsx   # Message bubble + citations
│       │   ├── Digest/
│       │   │   ├── DigestPanel.jsx   # Today + history tab switcher
│       │   │   └── AlertCard.jsx     # Fading concept with forget_score bar
│       │   ├── Input/
│       │   │   └── InputPanel.jsx    # URL/text/voice manual input
│       │   ├── Gaps/
│       │   │   └── GapAnalyser.jsx   # JD textarea + gap report table
│       │   └── Privacy/
│       │       └── PrivacyPanel.jsx  # Captured items list + delete actions
│       ├── pages/
│       │   ├── Dashboard.jsx         # Main layout composing all panels
│       │   ├── Onboarding.jsx        # Step-by-step setup wizard
│       │   └── WeeklyReport.jsx      # PDF preview + download
│       ├── hooks/
│       │   ├── useGraph.js           # Graph data + D3 simulation state
│       │   ├── useWebSocket.js       # WS connection + event dispatch
│       │   └── useChat.js            # Chat session state + API calls
│       └── api/
│           └── client.js             # Axios instance with base URL + API key header
├── data/                             # Runtime data (gitignored)
│   ├── capture_queue/                # Pending CaptureItems (JSON files)
│   ├── digests/                      # Stored DigestEntries
│   └── voice/                        # Voice recordings (chmod 600)
├── docs/                             # Architecture diagrams, API reference
├── docker-compose.yml
└── README.md
```

---

## Design Decisions and Rationale

| Decision | Rationale |
|----------|-----------|
| **Chrome Extension MV3** | Required by Chrome since Jan 2023; service worker background.js replaces persistent background pages, reducing memory. |
| **Groq API (Llama 3.3 70B)** | Sub-2s inference for concept extraction; free tier sufficient for nightly batch processing; avoids local GPU requirement for capstone. |
| **Neo4j for graph** | Native graph database with Cypher makes neighbourhood queries (1-2 hops) and typed edge traversal dramatically simpler than relational or document stores. APOC plugin enables advanced graph algorithms. |
| **ChromaDB for embeddings** | Lightweight, embeddable vector store with no server setup required; integrates well with Python ecosystem; local storage aligns with privacy requirement. |
| **APScheduler CronTrigger** | Embedded in FastAPI process; eliminates need for external task queue (Celery/Redis) for capstone scope. Can be upgraded to Celery if scaling beyond single machine. |
| **SM-2 exponential decay** | Well-understood algorithm from spaced repetition literature; deterministic and computationally cheap; forget_score in [0,1] maps naturally to visual indicators. |
| **Hybrid RAG** | Pure vector search misses structural knowledge (prerequisites, contradictions); pure graph traversal misses semantic similarity. Combining both covers edge cases and improves answer quality. |
| **trafilatura for scraping** | Outperforms BeautifulSoup and newspaper3k on boilerplate removal benchmarks; single-call API; actively maintained. |
| **WebSocket for live updates** | Graph additions during pipeline should appear in real-time on dashboard without polling; Socket.io-compatible protocol keeps frontend simple. |
| **Docker Compose** | Reproducible local environment for capstone demo; Neo4j and ChromaDB both have official Docker images; backend Dockerfile enables Railway deployment with no config change. |
