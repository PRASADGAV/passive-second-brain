# Implementation Plan: Passive Second Brain

## Overview

This plan converts the five-layer design into an incremental 16-week build sequence.
Each phase gates the next: Phase 1 must be green before Phase 2 starts, and so on.
All implementation is in Python (backend/pipeline/tests) and JavaScript/React (frontend/extension).
Property-based tests use **Hypothesis**; frontend tests use **Vitest + React Testing Library + Playwright**.
Tasks marked `*` are optional and can be deferred for a faster MVP build.

---

## Tasks


---

## PHASE 1 — FOUNDATION (Weeks 1–2)

**Goal:** Monorepo skeleton runs end-to-end. One successful API call reaches Neo4j, ChromaDB, and Groq.

---

- [x] 1. Initialise monorepo and project skeleton
  - [x] 1.1 Create monorepo folder structure
    - Create `/extension`, `/backend`, `/frontend`, `/docs`, `/data` directories at repo root
    - Add root `.gitignore` ignoring `data/`, `*.env`, `__pycache__/`, `node_modules/`, `.chroma/`, `neo4j_data/`
    - Add root `README.md` placeholder
    - _Requirements: 21.3 (secrets never in Git)_

  - [x] 1.2 Scaffold FastAPI backend skeleton
    - Create `backend/main.py` with FastAPI app init, CORS middleware, global exception handler (422/503/502/500), and `GET /health` endpoint returning `{"status": "ok"}`
    - Create `backend/.env.example` with `GROQ_API_KEY`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `PSB_API_KEY`, `DEVELOPER_MODE=false`
    - Create `backend/requirements.txt` with pinned versions: `fastapi==0.111.0`, `uvicorn==0.29.0`, `pydantic==2.7.1`, `python-dotenv==1.0.1`, `neo4j==5.20.0`, `chromadb==0.5.0`, `groq==0.9.0`, `apscheduler==3.10.4`, `hypothesis==6.100.1`
    - Configure structured JSON logging with `level`, `component`, `message`, `timestamp` fields matching the Error Log Schema in design §Error Handling
    - _Requirements: 24.1 (full exception trace logged), 21.3 (keys in env vars)_

  - [x] 1.3 Define all Pydantic schemas
    - Create `backend/models/schemas.py` with `SourceType`, `CaptureStatus`, `EdgeType` enums and `CaptureItem`, `ConceptNode`, `Edge`, `DigestEntry`, `RAGResult`, `GapReport` models exactly matching the Data Models section of the design
    - Validate field constraints: `ease_factor` in [1.3, 5.0], `forget_score` in [0.0, 1.0], `confidence` in [0.0, 1.0], `name` max 200 chars, `summary` max 500 chars
    - _Requirements: 8.3 (concept schema), 11.2 (node properties), 13.4 (forget_score range)_

  - [ ]* 1.4 Write unit tests for Pydantic schemas
    - Test valid construction of all models
    - Test field bound violations raise `ValidationError`
    - Test enum acceptance and rejection of invalid strings
    - _Requirements: 8.3, 11.2, 13.4_


- [x] 2. Set up Neo4j via Docker and CRUD services
  - [x] 2.1 Author `docker-compose.yml` with Neo4j, ChromaDB, and backend services
    - Use `neo4j:5.18-community` image, ports 7474 and 7687, APOC plugin enabled, named volume `neo4j_data`
    - Use `chromadb/chroma:latest` image, port 8000, named volume `chroma_data`
    - Add `backend` service with `depends_on`, `env_file`, and data volume mount as specified in design §Docker Compose
    - Add `psb_internal` bridge network
    - _Requirements: 11.4 (Neo4j scale), 12.4 (ChromaDB local)_

  - [x] 2.2 Implement Neo4j connection and schema initialisation
    - Create `backend/services/graph_db.py` with `Neo4jService` class
    - On startup, run Cypher `CREATE INDEX` statements for `concept_id`, `name`, `domain`, `forget_score` as defined in design §Neo4j Schema
    - Implement `upsert_node(node: ConceptNode)` using `MERGE ON CREATE SET / ON MATCH SET` Cypher with exponential backoff retry (3 attempts, 1s/2s/4s delays) per design §Error Handling
    - Implement `upsert_edge(edge: Edge)` for all six `EdgeType` labels
    - _Requirements: 11.1 (write nodes + edges), 11.3 (six edge types), 11.6 (retry on failure)_

  - [x] 2.3 Implement Neo4j read and delete operations
    - Add `get_node(concept_id: str) -> ConceptNode | None`
    - Add `get_all_nodes(skip=0, limit=500) -> List[ConceptNode]`
    - Add `get_neighbourhood(concept_id: str, hops: int = 2) -> dict` returning nodes + edges within N hops
    - Add `get_stats() -> dict` returning node count, edge count, domain breakdown
    - Add `delete_node(concept_id: str)` — removes node and all its edges
    - Add `delete_by_source(source_url: str)` — removes all nodes whose `source_url` matches
    - _Requirements: 11.5 (upsert no dup), 18.3 (node deletion), 18.4 (source deletion), 22.4 (sub-2s queries)_

  - [ ]* 2.4 Write property test for node upsert idempotence (Property 14)
    - **Property 14: Node Upsert Does Not Duplicate**
    - Use `st.builds(ConceptNode)` to generate random nodes; upsert same node twice; assert count remains 1
    - Tag: `# Feature: passive-second-brain, Property 14: upsert no duplicate`
    - **Validates: Requirements 11.5**


- [x] 3. Set up ChromaDB service and Groq API client
  - [x] 3.1 Implement ChromaDB vector service
    - Create `backend/services/vector_db.py` with `VectorDBService` class
    - On startup, get-or-create collection `psb_concepts` using `chromadb.HttpClient(host, port)`
    - Implement `upsert_embedding(concept_id: str, name: str, summary: str, metadata: dict)` — document text is `"{name}. {summary}"`, ID is `concept_id`
    - Implement `similarity_search(query: str, top_k: int = 5) -> List[str]` returning matching `concept_id` strings
    - Implement `delete_embedding(concept_id: str)` and `delete_embeddings_by_source(source_url: str)`
    - Retry once on connection error; log `concept_id` on final failure per design §Error Handling
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 3.2 Implement Groq API client wrapper
    - Create `backend/services/groq_client.py` with `GroqClient` class wrapping the `groq` SDK
    - Load `GROQ_API_KEY` from env; use model `llama-3.3-70b-versatile`
    - Implement `call(system_prompt: str, user_content: str) -> str` with retry on HTTP 429 (5s backoff)
    - Log `token_usage` and `latency_ms` for every call
    - _Requirements: 8.6 (Groq + Llama 3.3 70B), 28.5 (token usage visible)_

  - [x] 3.3 Wire health endpoint and run integration smoke test
    - Extend `GET /health` to return connectivity status for Neo4j, ChromaDB, and Groq (ping each)
    - Write `tests/integration/test_smoke.py`: start services via Docker Compose, call `/health`, assert all three show `"connected"`
    - _Requirements: 27.1 (health endpoint), 24.4 (pipeline status visible)_

- [x] 4. Phase 1 Checkpoint — Ensure all tests pass, ask the user if questions arise.
  - Run `pytest tests/` — all unit and smoke integration tests must be green
  - Confirm Swagger UI is accessible at `http://localhost:8080/docs`
  - Confirm `docker-compose up` starts all three services without errors


---

## PHASE 2 — CAPTURE + EXTRACTION ENGINE (Weeks 3–6)

**Goal:** Real content flows in. Full pipeline from URL → graph nodes. Chrome Extension works passively.

---

- [x] 5. Implement content scraping and ingestion services
  - [x] 5.1 Implement URL scraper service
    - Create `backend/services/scraper.py` with `scrape(url: str) -> str`
    - Use `trafilatura.fetch_url()` then `trafilatura.extract()` for boilerplate removal
    - Validate URL with Pydantic `AnyHttpUrl` before fetching; truncate output to 1 MB per design §Input Validation
    - Log failures with URL and timestamp without raising; return empty string on failure
    - _Requirements: 1.1 (extract visible text), 8.1 (cleaned text to pipeline), 21.2 (no raw text to external servers)_

  - [x] 5.2 Implement YouTube transcript service
    - Create `backend/services/youtube_svc.py` with `get_transcript(video_id: str) -> str`
    - Use `youtube_transcript_api.YouTubeTranscriptApi.get_transcript(video_id)`, join segments into single string
    - Log failures with video URL and timestamp; return empty string on failure
    - _Requirements: 2.2 (fetch transcript via youtube-transcript-api), 2.6 (log failure without crash)_

  - [x] 5.3 Implement PDF extractor service
    - Create `backend/services/pdf_svc.py` with `extract_pdf(path_or_url: str) -> List[str]`
    - Open document with `fitz.open()`; iterate pages; call `page.get_text()` per page
    - On per-page exception: log `{file_id, page_number, timestamp}`, append `""` for that page, continue
    - Return list of exactly N strings (one per page); empty string for failed pages
    - _Requirements: 3.1 (page-by-page extraction), 3.5 (log page failure, continue remaining pages)_

  - [x] 5.4 Write property test for PDF page completeness (Property 5)
    - **Property 5: PDF Page-by-Page Completeness**
    - Use `st.integers(1, 100)` for N; mock `fitz` to return N non-empty strings; assert `len(result) == N`
    - Tag: `# Feature: passive-second-brain, Property 5: pdf page completeness`
    - **Validates: Requirements 3.1, 3.2**

  - [x] 5.5 Write property test for PDF partial failure resilience (Property 6)
    - **Property 6: PDF Partial Failure Resilience**
    - Use `st.integers(1, 50)` for failure page K; assert all non-K pages extracted and exactly one failure log entry
    - Tag: `# Feature: passive-second-brain, Property 6: pdf partial failure resilience`
    - **Validates: Requirements 3.5**


- [x] 6. Implement text chunker and ingest API routers
  - [x] 6.1 Implement 512-token overlapping text chunker
    - Create `backend/services/chunker.py` with `chunk(text: str, max_tokens: int = 512, overlap: int = 50) -> List[str]`
    - Use `tiktoken` (or character-based approximation at 4 chars/token) to count tokens
    - Ensure every chunk ≤ 512 tokens; adjacent chunks share the last `overlap` tokens of the preceding chunk
    - _Requirements: 8.2 (512-token overlapping chunks)_

  - [x] 6.2 Write property test for text chunking token bound (Property 9)
    - **Property 9: Text Chunking Token Bound**
    - Use `st.text(min_size=0, max_size=50000)` for input; assert all chunks ≤ 512 tokens, overlap is correct, full coverage
    - Tag: `# Feature: passive-second-brain, Property 9: text chunking token bound`
    - **Validates: Requirements 8.2**

  - [x] 6.3 Implement Whisper voice transcription service
    - Create `backend/services/whisper_svc.py` with `transcribe(audio_path: str) -> str`
    - Call `whisper.cpp` via `subprocess.run(["whisper-cpp", audio_path, "--output-txt"])` — no network calls
    - Store audio in `data/voice/` with chmod 600; log failure + preserve audio file on exception
    - _Requirements: 4.2 (local Whisper), 4.3 (no external transmission), 4.5 (preserve audio on failure)_

  - [x] 6.4 Write property test for voice privacy invariant (Property 7)
    - **Property 7: Voice Note Privacy Invariant**
    - Mock the network layer with `unittest.mock`; run transcription; assert zero outbound calls with audio data
    - Tag: `# Feature: passive-second-brain, Property 7: voice privacy invariant`
    - **Validates: Requirements 4.3**

  - [x] 6.5 Implement ingest API routers
    - Create `backend/routers/ingest.py` with `POST /ingest/url`, `POST /ingest/youtube`, `POST /ingest/pdf` (multipart), `POST /ingest/text`
    - Each endpoint validates input, creates a `CaptureItem` (status=pending), persists to `data/capture_queue/` as JSON, returns `{item_id, status, queued_at}`
    - Apply `verify_api_key` FastAPI dependency on all four endpoints
    - _Requirements: 1.7 (store raw text locally), 7.4 (process all queued items), 27.2 (FastAPI OpenAPI)_

  - [x] 6.6 Implement domain classifier and blocked-domain filter
    - Create `backend/services/domain_filter.py` with `classify_domain(url: str, text: str, user_domains: List[str]) -> str | None`
    - Implement keyword-rule-based classifier: return matched user domain or `None` (unclassified)
    - Implement `is_blocked(url: str) -> bool` against hardcoded + user-configured block list (social media, entertainment, banking per FR-05)
    - Apply filter in all ingest endpoints before creating `CaptureItem`
    - _Requirements: 5.2 (tag with domain), 5.3 (blocked domain list), 5.4 (immediate filter update)_

  - [x] 6.7 Write property test for domain tag membership (Property 8)
    - **Property 8: Domain Tag Membership**
    - Use `st.lists(st.text(min_size=1), min_size=1)` for domain list; assert `classify_domain` result is in list or `None`
    - Tag: `# Feature: passive-second-brain, Property 8: domain tag membership`
    - **Validates: Requirements 5.2**


- [x] 7. Implement concept and relationship extraction
  - [x] 7.1 Author LLM prompt files
    - Create `backend/prompts/extract.py` with concept extraction system prompt (exact text from design §LLM Prompts)
    - Create `backend/prompts/gaps.py` with relationship extraction system prompt (exact text from design)
    - Create `backend/prompts/digest.py` with digest generation prompt
    - _Requirements: 8.1 (pipeline sends text to LLM), 15.1 (LLM generates digest)_

  - [x] 7.2 Implement concept extractor service
    - Create `backend/services/extractor.py` with `extract_concepts(chunk: str) -> ExtractionResult`
    - Call `GroqClient.call(extract_prompt, chunk)`; parse JSON response into list of `{name, domain, summary, confidence}`
    - On malformed JSON: log `chunk_id` + warning, return empty list; never raise
    - Validate each concept: `confidence` in [0.0, 1.0], `name` non-empty, `domain` non-empty, `summary` non-empty
    - Also extract relationships via second Groq call; validate `type` against `EdgeType` enum; discard invalid types and log warning
    - _Requirements: 8.3 (structured JSON with confidence), 8.5 (log malformed, continue), 9.3 (six valid edge types), 9.4 (discard invalid type)_

  - [x] 7.3 Write property test for extraction response schema validity (Property 10)
    - **Property 10: Concept Extraction Response Schema Validity**
    - Use `st.from_type(ExtractionResult)` (or fixed dict strategy); assert every concept has non-empty name/domain/summary and confidence in [0.0, 1.0]
    - Tag: `# Feature: passive-second-brain, Property 10: extraction response schema validity`
    - **Validates: Requirements 8.3, 8.4**

  - [x] 7.4 Write property test for relationship type validation (Property 11)
    - **Property 11: Relationship Type Validation**
    - Use `st.text()` for relationship type field; assert types outside the six valid values are discarded and not inserted
    - Tag: `# Feature: passive-second-brain, Property 11: relationship type validation`
    - **Validates: Requirements 9.3**

  - [x] 7.5 Implement entity resolution and deduplication service
    - Create `backend/services/resolver.py` with `resolve(concepts: List[RawConcept], graph_db: Neo4jService) -> List[ResolvedConcept]`
    - Apply string normalisation (lowercase, strip punctuation) and cosine similarity on name embeddings (via ChromaDB `similarity_search`) to detect duplicates
    - When two concepts resolve as duplicates: merge into single `ConceptNode` preserving all source URLs, timestamps, and edge relationships
    - Log merged concept names and resulting canonical `concept_id`
    - _Requirements: 10.1 (resolve before inserting), 10.2 (string norm + semantic), 10.3 (merge preserves edges), 10.4 (log merge)_

  - [x] 7.6 Write property test for entity resolution idempotence (Property 12)
    - **Property 12: Entity Resolution Idempotence**
    - Use `st.text()` for concept names C and C'; resolve C' against graph containing C; assert same `concept_id`, no new node
    - Tag: `# Feature: passive-second-brain, Property 12: entity resolution idempotence`
    - **Validates: Requirements 10.2, 10.5**

  - [x] 7.7 Write property test for concept merge preserving relationships (Property 13)
    - **Property 13: Concept Merge Preserves All Relationships**
    - Use `st.lists(st.builds(Edge))` for E_A and E_B; assert merged node has edge set E_A ∪ E_B, source set S_A ∪ S_B
    - Tag: `# Feature: passive-second-brain, Property 13: merge preserves relationships`
    - **Validates: Requirements 10.3**


- [x] 8. Build Chrome Extension MV3
  - [x] 8.1 Create Chrome Extension manifest and folder structure
    - Create `extension/manifest.json` (MV3) declaring permissions: `activeTab`, `storage`, `scripting`, `tabs`, `webNavigation`; host permissions `*://*/*`; background service worker `background.js`; content script `content.js`
    - Create `extension/popup/popup.html` and `extension/utils/` directory
    - _Requirements: 23.2 (minimum permissions)_

  - [x] 8.2 Implement `content.js` — reading timer and text extraction
    - Inject into every page (via manifest `content_scripts`)
    - Start 60-second timer on `DOMContentLoaded` (fires after `load` event per design §Extension)
    - On threshold: call `document.body.innerText`, send message to background; enforce `max_text_length = 100_000` chars
    - Monitor `video.currentTime / video.duration` for YouTube pages; fire 50% trigger message to background
    - try/catch all extraction calls; on failure send `{type: "CAPTURE_FAILED", url, error}` to background
    - _Requirements: 1.1 (extract text on threshold), 1.2 (default 60s), 2.1 (YT 50% trigger), 23.3 (no main thread blocking), 23.4 (defer after load)_

  - [x] 8.3 Implement `background.js` — service worker, queue, and POST to backend
    - Receive messages from content.js; apply `isBlocked(url)`, privacy list, and pause state before queueing
    - Queue captures in `chrome.storage.local["capture_queue"]`; POST to `POST /ingest/url` or `POST /ingest/youtube` with exponential backoff retry (max 3 attempts)
    - Handle `CAPTURE_FAILED` messages by logging to `chrome.storage.local["error_log"]`
    - _Requirements: 1.4 (skip blocked domain), 1.5 (skip private page), 1.6 (skip if paused), 1.8 (log failure), 6.2 (pause stops capture)_

  - [x] 8.4 Implement `utils/domain-filter.js` and `utils/youtube.js`
    - `domain-filter.js`: export `isBlocked(url)` checking against hardcoded and user-configured block list stored in `chrome.storage.local`
    - `youtube.js`: export `getVideoProgress()` returning `{videoId, percent, duration}` by reading YT player DOM state
    - _Requirements: 2.3 (filter non-educational YT), 5.3 (blocked domain list)_

  - [x] 8.5 Implement `popup/popup.js` — pause/resume toggle and status badge
    - Render ON/OFF toggle reading from `chrome.storage.local["tracking_paused"]`
    - On toggle: write updated state, send message to background, update `chrome.action.setBadgeText` to "OFF"/"ON"
    - Display queued item count from `chrome.storage.local["capture_queue"].length`
    - _Requirements: 6.1 (visible pause control), 6.3 (resume), 6.4 (visual indicator when paused)_

  - [x] 8.6 Write unit tests for domain filter and YouTube progress utility
    - Test `isBlocked` with known blocked domains (Instagram, Twitter, Netflix) and known allowed domains
    - Test `getVideoProgress` percent calculation with mock DOM values
    - _Requirements: 5.3, 2.1_


- [x] 9. Build Desktop Agent and batch processing
  - [x] 9.1 Implement Desktop Agent file watcher
    - Create `backend/desktop_agent.py` using `watchdog.observers.Observer` monitoring user-configured `PSB_INBOX_DIR` (default `~/Documents/PSB-inbox/`) for new `.pdf` files
    - On `FileCreatedEvent`: call `pdf_svc.extract_pdf(path)`, create `CaptureItem(source_type=pdf)`, POST to `/ingest/pdf`
    - Respect pause state read from a local state file; log all events
    - _Requirements: 3.2 (desktop agent detects PDF), 3.3 (respect pause), 3.4 (store raw text locally)_

  - [x] 9.2 Implement batch processing pipeline skeleton with error recovery
    - Create `backend/services/scheduler.py` using `APScheduler CronTrigger(hour=23)` (configurable via `PIPELINE_HOUR` env var)
    - Orchestrate: load all pending `CaptureItem` JSONs → scrape/transcribe → chunk → extract → resolve → upsert_node → upsert_embedding → sm2 → digest
    - Per-item try/except: on exception mark `status="failed"`, log `{item_id, trace}`, continue to next item
    - Record completed item IDs in a checkpoint file; on resume skip already-completed items
    - Log `PIPELINE_SLOW_WARNING` if elapsed > 300s; use `asyncio.gather` for chunk parallelism and `asyncio.Semaphore(5)` for Groq concurrency
    - _Requirements: 7.1 (APScheduler trigger), 7.2 (default 23:00), 7.3 (configurable time), 7.4 (process all queued), 7.7 (50 items in 5 min), 24.1–24.3 (resumable on failure), 22.1 (pipeline throughput NFR)_

  - [x] 9.3 Write integration test for full pipeline run (50 items)
    - Generate 50 mock `CaptureItem` JSONs; run scheduler pipeline; assert `items_processed == 50` and elapsed < 300s
    - _Requirements: 7.7, 22.1_

- [x] 10. Phase 2 Checkpoint — Ensure all tests pass, ask the user if questions arise.
  - `pytest tests/` must be fully green including property tests
  - Manually: load a real article URL via `POST /ingest/url`; run pipeline; confirm nodes appear in Neo4j Browser at `localhost:7474`
  - Sideload extension in Chrome (`chrome://extensions`); browse a page for 65 seconds; confirm `capture_queue` shows an entry


---

## PHASE 3 — KNOWLEDGE GRAPH + MEMORY LAYER (Weeks 7–9)

**Goal:** Graph grows intelligently with PageRank/community detection. SM-2 memory decay runs nightly. RAG pipeline answers questions.

---

- [x] 11. Implement graph algorithms and memory APIs
  - [x] 11.1 Implement Neo4j graph algorithm calls (PageRank + community detection)
    - Add `compute_pagerank()` to `graph_db.py` using APOC `gds.pageRank` or manual Cypher approximation; update `importance_score` field on each node
    - Add `detect_communities()` using APOC `gds.louvain` or `gds.wcc`; update `domain` or add `community_id` property on nodes
    - Call both after each nightly pipeline run (in `scheduler.py`)
    - _Requirements: 11.2 (node properties), 17.2 (size by importance score)_

  - [x] 11.2 Implement `GET /graph/neighbourhood` and `GET /graph/stats` routers
    - Create `backend/routers/graph.py` with `GET /graph/nodes`, `GET /graph/neighbourhood/{id}?hops=2`, `GET /graph/stats`, `POST /graph/concept`, `DELETE /graph/concept/{id}`, `DELETE /graph/source/{url}`
    - Apply `verify_api_key` dependency; return 404 for missing `concept_id`; return 422 for invalid params
    - Neighbourhood query: limit to 2 hops per design §Graph Query Performance
    - _Requirements: 27.1 (all graph ops in REST), 27.3 (422 on invalid), 27.4 (404 on missing)_

  - [ ]* 11.3 Write property test for API input validation (Property 22)
    - **Property 22: API Input Validation — 422 and 404 Responses**
    - Use `st.fixed_dictionaries` with missing/invalid params; assert 422 returned; use non-existent concept_ids; assert 404
    - Tag: `# Feature: passive-second-brain, Property 22: API validation responses`
    - **Validates: Requirements 27.3, 27.4**

- [x] 12. Implement SM-2 forgetting score computation
  - [x] 12.1 Implement `sm2.py` service
    - Create `backend/services/sm2.py` with `compute_forget_score(node: ConceptNode) -> float` implementing formula: `round(1 - exp(-days_since_seen / (rep_interval * ease_factor)), 4)`
    - Implement `update_sm2_on_review(node: ConceptNode, quality: int = 4) -> dict` updating `ease_factor` (clamped to [1.3, 5.0]), `rep_interval`, `rep_count` using full SM-2 update rules from design
    - After nightly pipeline graph writes, iterate all nodes and call `compute_forget_score`; batch-update `forget_score` in Neo4j
    - When a concept appears in new captured content, call `update_sm2_on_review` treating re-encounter as review event
    - _Requirements: 13.1 (recalculate every node), 13.2 (SM-2 formula), 13.3 (update all SM-2 fields), 13.5 (re-encounter = review)_

  - [ ]* 12.2 Write property test for SM-2 forget score formula correctness (Property 16)
    - **Property 16: SM-2 Forget Score Formula Correctness**
    - Use `st.floats(1.3, 5.0)` for ef, `st.integers(1, 365)` for ri, `st.integers(0, 730)` for d; assert result equals `round(1 - exp(-d/(ri*ef)), 4)` and lies in [0.0, 1.0]
    - Tag: `# Feature: passive-second-brain, Property 16: SM-2 formula correctness`
    - **Validates: Requirements 13.2, 13.4**

  - [ ]* 12.3 Write unit tests for SM-2 update logic
    - Test all six quality grades (0–5) produce correct `ease_factor`, `rep_interval`, `rep_count`
    - Test clamp: `ease_factor` never below 1.3 or above 5.0
    - _Requirements: 13.2, 13.3_

  - [x] 12.4 Implement `GET /memory/alerts` endpoint
    - Create `backend/routers/memory.py` with `GET /memory/alerts?threshold=0.7` returning all nodes where `forget_score > threshold`
    - Default threshold 0.7; configurable per query param and user settings
    - Record view events: `POST /memory/review/{concept_id}` calls `update_sm2_on_review` and updates Neo4j
    - _Requirements: 14.1 (identify nodes below threshold), 14.3 (record view as review), 14.4 (configurable threshold)_


- [x] 13. Implement daily digest generation
  - [x] 13.1 Implement `digest_gen.py` service
    - Create `backend/services/digest_gen.py` with `generate_digest(stats: PipelineStats) -> DigestEntry`
    - Call `GroqClient.call(digest_prompt, stats_summary)` to generate `summary_text`
    - Construct `DigestEntry` with `date`, `new_concepts_count`, `new_edges_count`, `domains_covered`, `fading_concepts` (concept_ids where `forget_score > threshold`)
    - Persist `DigestEntry` to `data/digests/{date}.json`; retain at least 30 days
    - On Groq failure: log failure, skip digest generation, do not fail rest of pipeline
    - _Requirements: 15.1 (LLM generates digest), 15.2 (digest content), 15.3 (store with timestamp), 15.5 (30-day retention), 15.6 (failure doesn't abort pipeline)_

  - [x] 13.2 Implement digest API router
    - Create `backend/routers/digest.py` with `GET /digest/today` (latest) and `GET /digest/history` (last 30 entries)
    - Load from `data/digests/`; return 404 if no digest exists for today
    - _Requirements: 15.4 (dashboard shows latest digest), 15.5 (30-day access)_

  - [ ]* 13.3 Write unit tests for digest generation
    - Test `DigestEntry` construction with known `PipelineStats`; assert all fields populated correctly
    - _Requirements: 15.2_

- [x] 14. Implement hybrid RAG pipeline
  - [x] 14.1 Implement `rag.py` hybrid retrieval service
    - Create `backend/services/rag.py` with `query(q: str, session_history: List[dict]) -> RAGResult`
    - Step 1: `vector_db.similarity_search(q, top_k=5)` → list of `concept_id`s (~50ms)
    - Step 2: for each `concept_id`, `graph_db.get_neighbourhood(id, hops=2)` → expand context (~100ms)
    - Step 3: deduplicate combined context; limit to 8 chunks for Groq context window
    - Step 4: call `GroqClient` with context + last 10 session turns + user query; get grounded answer
    - Build `citations` list from retrieved nodes: `[{node_id, name, source_url}]`
    - If ChromaDB + Neo4j return empty results: return `{answer: "No relevant knowledge found.", citations: []}`
    - _Requirements: 16.2 (hybrid RAG), 16.3 (LLM answer with context), 16.4 (source citations), 16.5 (≤3s), 16.6 (session context), 16.7 (no hallucination on empty)_

  - [x] 14.2 Implement `POST /chat` router
    - Create `backend/routers/chat.py` with `POST /chat` accepting `{query, session_id}`
    - Maintain session history keyed by `session_id` (last 10 turns in-memory dict)
    - Call `rag.query()`; return `RAGResult` within 3s; validate response time in unit test
    - _Requirements: 16.1 (chat interface API), 16.5 (≤3s response), 16.6 (multi-turn)_

  - [ ]* 14.3 Write property test for RAG citations non-empty (Property 17)
    - **Property 17: RAG Citations Non-Empty for Found Knowledge**
    - Mock ChromaDB/Neo4j to return ≥1 result for any query; assert `citations` is non-empty and each has valid `node_id` and `source_url`
    - Tag: `# Feature: passive-second-brain, Property 17: RAG citations non-empty`
    - **Validates: Requirements 16.4**

  - [ ]* 14.4 Write integration test for RAG latency
    - End-to-end with real Neo4j + ChromaDB seeded with 50 nodes; call `POST /chat`; assert response_time < 3s
    - _Requirements: 22.2 (3s RAG response NFR)_

- [x] 15. Phase 3 Checkpoint — Ensure all tests pass, ask the user if questions arise.
  - `pytest tests/` green including all property tests
  - Manually trigger pipeline; confirm `GET /digest/today` returns a digest
  - Call `POST /chat` with a question; confirm grounded answer with citations returns in < 3s


---

## PHASE 4 — FRONTEND DASHBOARD (Weeks 10–13)

**Goal:** Full working React UI. D3.js graph is the showstopper demo. All panels wired to live API.

---

- [x] 16. Scaffold React frontend and design system
  - [x] 16.1 Scaffold React + Vite frontend
    - Run `npm create vite@latest frontend -- --template react` inside `/frontend`
    - Install and configure Tailwind CSS, `d3`, `framer-motion`, `socket.io-client`, `axios`; pin all versions in `package.json`
    - Create `frontend/src/api/client.js` with Axios instance reading `VITE_API_BASE_URL` and `VITE_API_KEY` from `import.meta.env` — never hardcoded
    - _Requirements: 21.3 (API keys not in frontend source)_

  - [x] 16.2 Implement design system tokens and base layout
    - Define Tailwind config with custom color palette (domain colors matching D3 `schemeTableau10`), typography scale, and spacing tokens
    - Create `Dashboard.jsx` main layout: graph canvas (70% width) + sidebar (30%) + top nav with pause/resume control
    - Create `Onboarding.jsx` step-by-step wizard: Neo4j setup → ChromaDB setup → Groq API key → Extension install → sample graph load
    - _Requirements: 6.1 (visible pause control in dashboard), 25.1 (pre-loaded sample graph), 25.2 (setup flow)_

  - [x] 16.3 Implement API hooks: `useGraph`, `useWebSocket`, `useChat`
    - `useGraph.js`: fetch `GET /graph/nodes` on mount; maintain D3 simulation data state; subscribe to `node_added`/`edge_added` WebSocket events to append nodes/edges
    - `useWebSocket.js`: establish `WS /ws`; dispatch events to registered handlers; auto-reconnect on disconnect
    - `useChat.js`: manage `messages[]` state; call `POST /chat`; append `{role, content, citations}` response
    - _Requirements: 16.1 (chat API), 17.5 (real-time via WebSocket)_


- [x] 17. Build D3.js interactive graph canvas
  - [x] 17.1 Implement static D3.js force graph (`GraphCanvas.jsx`)
    - Fetch nodes from `GET /graph/nodes`; render `<circle>` per node, `<line>` per edge using D3 SVG
    - Set up force simulation: `forceLink(distance=80)`, `forceManyBody(strength=-200)`, `forceCenter`, `forceCollide` as defined in design §D3.js Force Graph
    - Node radius: `6 + Math.sqrt(edge_count + rep_count) * 1.5`; node colour: `d3.scaleOrdinal(d3.schemeTableau10)` keyed on `domain`
    - Run simulation on a Web Worker to avoid blocking main thread
    - _Requirements: 17.1 (D3 force-directed), 17.2 (size by importance), 17.3 (colour by domain)_

  - [x] 17.2 Add graph interactions: zoom, pan, drag, hover labels
    - Implement `d3.zoom()` for pan and zoom; `d3.drag()` for node dragging
    - Show edge-type label on edge hover; show node name label on node hover
    - _Requirements: 17.4 (edge labels on hover), 17.8 (pan, zoom, drag)_

  - [x] 17.3 Implement WebSocket live node and edge animation
    - On `node_added` WebSocket event: animate new node entering the simulation (Framer Motion scale-in)
    - On `edge_added` event: animate edge drawing from source to target
    - Batch WebSocket events with 200ms accumulator before applying to simulation
    - _Requirements: 17.5 (real-time animation via WebSocket)_

  - [x] 17.4 Implement node click detail panel (`NodeDetail.jsx`) and graph search
    - On node click: display `NodeDetail` sidebar with `name`, `domain`, `summary`, `source_url`, `created_at`, `last_seen`, `forget_score`, list of neighbour names
    - Implement graph search input in `GraphControls.jsx`: on type, highlight matching nodes by name substring; non-matching nodes dim to 20% opacity
    - _Requirements: 17.7 (node detail on click), 17.6 (500 nodes at ≥30fps), 22.3 (30fps NFR)_

  - [ ]* 17.5 Write frontend tests for GraphCanvas
    - Vitest + RTL: assert correct node count renders; assert `NodeDetail` appears on node click
    - _Requirements: 17.1, 17.7_

  - [x] 17.6 Add WebSocket manager to FastAPI backend (`/ws`)
    - Create `WebSocketManager` in `backend/main.py` with `connect`, `disconnect`, `broadcast`
    - Register `/ws` endpoint; broadcast `node_added`, `edge_added`, `pipeline_status` events during pipeline run
    - Public endpoint (no API key required for WebSocket connection)
    - _Requirements: 17.5 (WebSocket updates), 27.5 (API key not required for reads)_

  - [ ]* 17.7 Write integration test for WebSocket events
    - Connect to `WS /ws`; trigger `POST /pipeline/trigger`; assert `node_added` events received within 30s
    - _Requirements: 17.5_


- [x] 18. Build Chat, Digest, and Forgetting Alerts panels
  - [x] 18.1 Implement Chat UI (`ChatPanel.jsx` + `ChatMessage.jsx`)
    - Render scrollable message list; input box with send button; "typing..." indicator while awaiting response
    - Each `ChatMessage` renders role-appropriate bubble (user/assistant) plus clickable source citation links below assistant messages
    - Wire to `useChat.js` which calls `POST /chat`; stream is simulated by displaying response on arrival
    - _Requirements: 16.1 (chat interface), 16.4 (citations), 16.5 (response < 3s)_

  - [x] 18.2 Implement Daily Digest panel (`DigestPanel.jsx` + `AlertCard.jsx`)
    - Fetch `GET /digest/today` on mount; render as formatted card with counts, domains, summary text
    - Below digest: render fading-concept `AlertCard` list from `fading_concepts` (fetch `GET /memory/alerts`)
    - `AlertCard`: show concept name, `forget_score` as horizontal progress bar, "Review" button that POSTs to `POST /memory/review/{id}`
    - Visually distinguish threshold-crossing nodes (red tint) from new nodes (green tint)
    - _Requirements: 14.2 (list threshold nodes), 14.3 (review updates SM-2), 14.5 (visual distinction), 15.4 (show latest digest)_

  - [x] 18.3 Implement Input panel (`InputPanel.jsx`)
    - URL text field → `POST /ingest/url` on submit
    - PDF file upload → `POST /ingest/pdf` multipart on select
    - Text area → `POST /ingest/text` on submit
    - Voice record button: call browser MediaRecorder API → save audio blob → `POST /ingest/voice` (triggers Whisper)
    - Show queued item count badge; handle error states (failed POST shows inline error)
    - _Requirements: 4.1 (voice recording in dashboard), 6.5 (pause stops enqueueing)_

  - [ ]* 18.4 Write frontend tests for Chat and Digest panels
    - Vitest + RTL: ChatPanel submits query and displays response + citations; DigestPanel renders digest from mock API; AlertCard "Review" button calls review endpoint
    - _Requirements: 16.1, 14.2, 14.3_


- [x] 19. Build Knowledge Gap Detector and Privacy Control Panel
  - [x] 19.1 Implement Gap Analysis backend
    - Create `backend/routers/gaps.py` with `POST /gaps` accepting `{job_description: str}`
    - Strip HTML from job description input before LLM call (security sanitisation)
    - Call `GroqClient` with `gaps.py` prompt to extract `required_skills[]`
    - Cross-reference each skill against Neo4j via `similarity_search` to determine present/missing
    - Return `GapReport`: `present_skills [{skill, concept_id, forget_score}]`, `missing_skills [str]`
    - _Requirements: 19.2 (extract skills via LLM), 19.3 (cross-reference graph), 19.6 (message if no skills found)_

  - [x] 19.2 Implement `GapAnalyser.jsx` component
    - Render job description textarea + "Analyse" button
    - POST to `/gaps`; show loading state; render gap report in two columns: "You know" (green) and "Missing" (red)
    - Each present skill shows `forget_score` bar; each missing skill shows a "Search" link
    - Display "None of the required skills have been captured yet" message when `present_skills` is empty
    - _Requirements: 19.1 (gap detector panel), 19.4 (gap report UI), 19.5 (click gap to search), 19.6 (empty message)_

  - [ ]* 19.3 Write property test for skill presence classification correctness (Property 20)
    - **Property 20: Skill Presence Classification Correctness**
    - Use `st.lists(st.text())` for skills S; mock graph state G; assert each skill classified present XOR missing, never in both lists
    - Tag: `# Feature: passive-second-brain, Property 20: skill presence classification correctness`
    - **Validates: Requirements 19.3**

  - [x] 19.4 Implement Privacy Control Panel (`PrivacyPanel.jsx`) and deletion backend
    - List all `CaptureItem` records from `data/capture_queue/` + processed items; show `source_url`, `captured_at`, `source_type`, `status`
    - "Delete Node" button → `DELETE /graph/concept/{id}` (removes node + edges from Neo4j and ChromaDB)
    - "Delete Source" button → `DELETE /graph/source/{url}` (removes all derived nodes + raw captured text)
    - After deletion: show count of removed nodes/edges; show 207 Multi-Status partial failure alert if deletion is incomplete
    - Unclassified items shown for user review per FR-05
    - _Requirements: 18.1 (list all captured items), 18.2 (show metadata), 18.3 (node deletion), 18.4 (source deletion), 18.5 (confirm count), 18.6 (no copy retained), 18.7 (report partial failure), 5.5 (unclassified items in panel)_

  - [ ]* 19.5 Write property test for node deletion completeness (Property 18)
    - **Property 18: Node Deletion Completeness**
    - Use `st.builds(ConceptNode)` with edges; delete node; assert absent from both Neo4j and ChromaDB, all referencing edges absent
    - Tag: `# Feature: passive-second-brain, Property 18: node deletion completeness`
    - **Validates: Requirements 18.3**

  - [ ]* 19.6 Write property test for source deletion cascade (Property 19)
    - **Property 19: Source Deletion Cascade**
    - Use `st.integers(1, 20)` for N derived nodes; delete by source; assert all N nodes + all connected edges absent from both stores
    - Tag: `# Feature: passive-second-brain, Property 19: source deletion cascade`
    - **Validates: Requirements 18.4**

  - [ ]* 19.7 Write frontend tests for Privacy panel
    - Vitest + RTL: delete button calls `DELETE` endpoint; item removed from list; confirmation count shown
    - _Requirements: 18.3, 18.5_


- [x] 20. Build Onboarding flow and Weekly Report page
  - [x] 20.1 Complete `Onboarding.jsx` step wizard
    - Step 1: check Docker running + show `docker-compose up` command; poll `/health` until all services connected
    - Step 2: prompt for Groq API key; write to local `.env` instructions (never stored in frontend)
    - Step 3: show Chrome Extension sideload instructions with screenshot
    - Step 4: load pre-seeded sample graph (50 nodes from `data/sample/sample_graph.json`) via `POST /graph/seed`; add `POST /graph/seed` backend endpoint; add "Clear sample data" button calling `DELETE /graph/source/sample`
    - Complete within 15 minutes on standard hardware
    - _Requirements: 25.1 (pre-loaded sample), 25.2 (step-by-step guide), 25.3 (15-min onboarding), 25.4 (clear sample)_

  - [x] 20.2 Implement `WeeklyReport.jsx` page and `GET /report/weekly` backend
    - Create `backend/routers/report.py` with `GET /report/weekly` using `fpdf2` to generate PDF
    - PDF content: new concepts per day bar chart data, top-10 concepts by edge count, domains covered, threshold-crossing concepts; file name `psb-weekly-report-YYYY-MM-DD.pdf`
    - `WeeklyReport.jsx`: fetch last 7 days digest entries; render as formatted page; "Download PDF" button hits `GET /report/weekly` and triggers browser download
    - On PDF generation failure: return 500 error message; dashboard shows error toast; no partial/corrupt file served
    - _Requirements: 20.1 (download PDF control), 20.2 (7-day stats), 20.3 (formatted PDF), 20.4 (file naming), 20.5 (error on failure)_

  - [ ]* 20.3 Write property test for weekly report statistics accuracy (Property 21)
    - **Property 21: Weekly Report Statistics Accuracy**
    - Use `st.integers(0, 500)` for M node additions and K edge additions; generate report; assert counts match exactly
    - Tag: `# Feature: passive-second-brain, Property 21: weekly report statistics accuracy`
    - **Validates: Requirements 20.2**

  - [ ]* 20.4 Write Playwright E2E test for onboarding flow
    - Simulate first-time user: open dashboard → step through onboarding wizard → confirm sample graph renders in `GraphCanvas`
    - _Requirements: 25.1, 25.2_

- [x] 21. Phase 4 Checkpoint — Ensure all tests pass, ask the user if questions arise.
  - `npm run test` (Vitest) and `pytest tests/` both fully green
  - Open dashboard at `localhost:5173`; confirm D3 graph renders with sample data, chat returns answers, digest shows, gap analyser works, privacy panel lists and deletes items


---

## PHASE 5 — POLISH + DEPLOY + DOCUMENTATION (Weeks 14–16)

**Goal:** Live URL. Demo-ready. GitHub README complete. All Layer 5 extras implemented.

---

- [x] 22. Implement Layer 5 extras: Graph Export, Prompt Playground, Pipeline Trigger API
  - [x] 22.1 Implement Graph Export endpoints and UI
    - Create `GET /export/json` in `graph.py` router: serialise all `ConceptNode` + `Edge` objects from Neo4j into JSON with `exported_at`; return as `application/json` download named `psb-graph-export-YYYY-MM-DD.json`
    - Add PNG export to `GraphCanvas.jsx`: serialize current SVG to canvas using `html2canvas` or SVG blob URL; trigger `<a download>` for PNG file
    - Add "Export JSON" and "Export PNG" buttons to `GraphControls.jsx`
    - On export failure: return descriptive error; dashboard shows error toast; no partial file served
    - _Requirements: 26.1 (JSON + image controls), 26.2 (JSON serialise all nodes/edges), 26.3 (PNG from canvas), 26.4 (file naming), 26.5 (error on failure)_

  - [x] 22.2 Implement Groq Prompt Playground backend and UI
    - Create `POST /playground` in a new `backend/routers/playground.py`; guard with `DEVELOPER_MODE=true` env check; accept `{prompt, sample_text}`; call Groq API; return `{raw_response, token_usage, latency_ms}`
    - Allow developer to edit `extract.py`, `digest.py`, `gaps.py` prompt content via playground; persist on save; use in subsequent pipeline runs
    - Create `PromptPlayground.jsx` component in dashboard (hidden unless `VITE_DEVELOPER_MODE=true`): prompt selector dropdown, editable textarea, sample text input, response display, token/latency stats
    - _Requirements: 28.1 (developer mode only), 28.2 (raw JSON response), 28.3 (edit all three prompts), 28.4 (persist and use in pipeline), 28.5 (token usage + latency)_

  - [x] 22.3 Implement Pipeline Status and Manual Trigger API
    - Add `GET /pipeline/status` (public) returning `{status, last_run, items_processed, error}`
    - Add `POST /pipeline/trigger` (API key required) immediately enqueuing a pipeline run outside schedule
    - Display pipeline status indicator in top nav (idle/running/failed with last run time)
    - _Requirements: 24.4 (expose pipeline status), 27.1 (pipeline trigger in REST API)_


- [x] 23. Frontend polish: loading states, error states, and performance
  - [x] 23.1 Add skeleton loading screens for all async panels
    - `GraphCanvas`: render grey pulsing circles while `GET /graph/nodes` is pending (Tailwind `animate-pulse`)
    - `DigestPanel`: skeleton card rows while `GET /digest/today` is pending
    - `ChatPanel`: skeleton bubble while awaiting response
    - _Requirements: 22.2 (3s RAG ensures fast response)_

  - [x] 23.2 Implement error state components for all API failure scenarios
    - Empty graph state: show "No concepts yet — start browsing or add a URL" placeholder with call-to-action
    - Failed API call: show inline error banner with retry button for graph, chat, and digest panels
    - No chat results: show "No relevant knowledge found" message (aligns with FR-16.7)
    - Corrupted data: handle JSON parse errors gracefully; show error card, do not crash app
    - _Requirements: 16.7 (no hallucination), 24.1 (errors logged)_

  - [x] 23.3 Graph performance optimisation for 500+ nodes
    - Add level-of-detail threshold: when node count > 500, switch SVG renderer to Canvas renderer; hide edge labels; reduce node radius by 30%
    - Confirm force simulation runs on Web Worker (set up in 17.1)
    - Target: ≥30fps at 500 nodes on a standard consumer laptop; verify with `requestAnimationFrame` timing logs
    - _Requirements: 17.6 (500 nodes at ≥30fps), 22.3 (30fps NFR)_

  - [x] 23.4 Implement responsive layout for 13" and 15" screens
    - Add Tailwind responsive breakpoints: on `lg` (1024px) graph canvas 70% / sidebar 30%; on `md` (768px) stack vertically
    - Confirm all panels are usable without horizontal scroll on 1280×800 viewport
    - _Requirements: NFR responsive layout_

- [x] 24. Security review and hardening
  - [x] 24.1 Apply security controls across backend and frontend
    - Confirm `PSB_API_KEY` validated on all non-public endpoints via `verify_api_key` FastAPI dependency
    - Confirm CORS configured in `main.py` to allow only `http://localhost:5173` (and Vercel domain once deployed)
    - Confirm all URL inputs validated with Pydantic `AnyHttpUrl`; all text inputs truncated to 1MB; job description HTML-stripped
    - Confirm `GROQ_API_KEY` and `PSB_API_KEY` never appear in frontend JS bundle (check Vite build output with `grep`)
    - Confirm `.env` is in `.gitignore`; confirm `.env.example` has no real values
    - _Requirements: 21.3 (secrets in env vars), 23.1 (extension permissions), 27.5 (API key auth)_

  - [ ]* 24.2 Write security-focused unit tests
    - Test that `verify_api_key` rejects requests with wrong or missing key (returns 401)
    - Test that `POST /playground` returns 403 when `DEVELOPER_MODE=false`
    - Test URL input with `javascript:` scheme is rejected (422)
    - _Requirements: 21.3, 27.5, 28.1_


- [x] 25. Deployment: Railway, Vercel, and Chrome Extension packaging
  - [x] 25.1 Prepare backend Dockerfile and Railway deployment
    - Create `backend/Dockerfile` using `python:3.11-slim`; `COPY requirements.txt`, `pip install`, `EXPOSE 8080`, `CMD uvicorn main:app`
    - Push to GitHub; connect Railway project to repo; set all environment variables in Railway dashboard
    - Update `CORS` allowed origins in `main.py` to include the Railway URL
    - Confirm `GET /health` returns 200 on Railway URL
    - _Requirements: 21.3 (env vars in Railway, not in code)_

  - [x] 25.2 Deploy frontend to Vercel
    - Connect GitHub repo to Vercel; set `VITE_API_BASE_URL` and `VITE_API_KEY` in Vercel environment variables
    - Configure Vercel to build from `/frontend` directory with `npm run build`
    - Confirm dashboard loads at Vercel URL and successfully calls Railway backend
    - Set up auto-deploy on push to `main` branch
    - _Requirements: 21.3 (VITE env vars, not hardcoded)_

  - [x] 25.3 Package Chrome Extension zip
    - Run `zip -r psb-extension.zip extension/` excluding any test or dev files
    - Write sideload instructions in `docs/extension-sideload.md`: enable Developer Mode → Load Unpacked → select `/extension`
    - _Requirements: 23.2 (minimal permissions)_

- [x] 26. Documentation and GitHub README
  - [x] 26.1 Create Architecture Diagram
    - Draw system architecture diagram in Excalidraw matching the ASCII architecture in design §Architecture
    - Export as `docs/architecture.png`
    - _Requirements: (capstone documentation)_

  - [x] 26.2 Write comprehensive GitHub README
    - Sections: hero GIF (screen recording of D3 graph + chat), architecture diagram embed, tech stack badges, prerequisites, setup guide (Docker Compose + Extension sideload + Groq key), API reference link to `/docs`, project structure overview
    - _Requirements: 27.2 (OpenAPI at /docs)_

  - [x] 26.3 Finalize `docker-compose.yml` with health checks and volumes
    - Add `healthcheck` entries to all three services (Neo4j: bolt ping, ChromaDB: HTTP /api/v1/heartbeat, backend: HTTP /health)
    - Confirm named volumes `neo4j_data`, `neo4j_logs`, `chroma_data` all declared
    - Test `docker-compose up --build` from a clean state completes without errors
    - _Requirements: 24.5 (preserve data if DB unavailable)_

  - [x] 26.4 Finalize REST API documentation
    - Confirm all 21 endpoints listed in design §Full Endpoint Table are present in FastAPI with docstrings
    - Confirm Swagger UI at `/docs` shows all request/response schemas including WebSocket event schema in description
    - _Requirements: 27.2 (OpenAPI at /docs), 27.1 (all graph operations documented)_

- [x] 27. Final Checkpoint — Ensure all tests pass, ask the user if questions arise.
  - `pytest tests/` and `npm run test` both fully green (including all 22 property tests, unit tests, integration tests)
  - `playwright test` E2E suite passes (onboarding, dashboard load, chat round-trip)
  - Live demo at Railway + Vercel URLs works end-to-end: browse → capture → pipeline → graph renders → chat answers
  - Extension sideloaded and tested: 60s on a page → node appears in dashboard graph via WebSocket


---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The 22 property tests map 1:1 to the Correctness Properties in `design.md`.
- All property tests use **Hypothesis** with minimum 100 iterations. Tag format: `# Feature: passive-second-brain, Property {N}: {description}`.
- **Phase dependency order is strict:** Phase 2 requires Phase 1 green. Phase 3 requires Phase 2. Phase 4 requires Phase 3. Phase 5 requires Phase 4.
- All secret values (`GROQ_API_KEY`, `PSB_API_KEY`, Neo4j credentials) must live in `.env` and never appear in frontend source or Git history.
- The design document (`design.md`) contains full Cypher schema, D3 simulation setup code, Pydantic models, and Docker Compose config — reference it during each implementation task.
- The requirements document (`requirements.md`) contains all acceptance criteria (FR-01 to FR-29, NFR-01 to NFR-12) — each task references the specific clause it satisfies.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "3.1", "3.2"] },
    { "id": 3, "tasks": ["3.3", "5.1", "5.2", "5.3", "6.3"] },
    { "id": 4, "tasks": ["5.4", "5.5", "6.1", "6.6"] },
    { "id": 5, "tasks": ["6.2", "6.4", "6.5", "6.7", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.5", "9.1"] },
    { "id": 7, "tasks": ["7.3", "7.4", "7.6", "7.7", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 9, "tasks": ["8.5", "8.6", "9.2"] },
    { "id": 10, "tasks": ["9.3", "11.1", "12.1"] },
    { "id": 11, "tasks": ["11.2", "12.2", "12.3", "12.4"] },
    { "id": 12, "tasks": ["11.3", "13.1"] },
    { "id": 13, "tasks": ["13.2", "13.3", "14.1"] },
    { "id": 14, "tasks": ["14.2", "14.3", "14.4", "16.1"] },
    { "id": 15, "tasks": ["16.2", "16.3"] },
    { "id": 16, "tasks": ["17.1"] },
    { "id": 17, "tasks": ["17.2", "17.3", "17.6"] },
    { "id": 18, "tasks": ["17.4", "17.5", "17.7", "18.1", "18.3"] },
    { "id": 19, "tasks": ["18.2", "18.4", "19.1"] },
    { "id": 20, "tasks": ["19.2", "19.3", "19.4"] },
    { "id": 21, "tasks": ["19.5", "19.6", "19.7", "20.1"] },
    { "id": 22, "tasks": ["20.2", "20.3", "20.4"] },
    { "id": 23, "tasks": ["22.1", "22.2", "22.3"] },
    { "id": 24, "tasks": ["23.1", "23.2", "23.3", "23.4"] },
    { "id": 25, "tasks": ["24.1", "24.2"] },
    { "id": 26, "tasks": ["25.1", "25.2", "25.3", "26.1", "26.2"] },
    { "id": 27, "tasks": ["26.3", "26.4"] }
  ]
}
```
