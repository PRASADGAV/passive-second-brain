# Requirements Document

## Introduction

Passive Second Brain is an AI-powered personal knowledge management system that automatically builds a semantic knowledge graph from a user's digital learning activity. The system monitors browsing behaviour, YouTube viewing, PDF reading, and voice notes entirely in the background, requiring zero manual input. Captured content is processed nightly by an AI pipeline that extracts concepts and relationships, stores them in a Neo4j graph database, computes spaced-repetition forgetting scores, and surfaces insights through a React dashboard. All raw data is stored exclusively on the user's local machine, and the user retains full visibility and deletion control over every captured item.

This is a B.Tech final-year capstone project composed of five integrated layers: Passive Capture Engine, Nightly AI Processing Pipeline, Semantic Knowledge Graph and Memory, React Frontend Dashboard, and Extras (reports, export, API, developer tooling).

---

## Glossary

- **System**: The complete Passive Second Brain application spanning all five layers.
- **Extension**: The Chrome Extension (Manifest V3) component responsible for passive capture in the browser.
- **Desktop_Agent**: The optional desktop file-watcher component that monitors locally opened PDFs.
- **Capture_Engine**: Layer 1 — the combined Extension and Desktop_Agent responsible for detecting and extracting raw content.
- **Pipeline**: Layer 2 — the nightly APScheduler-driven AI processing pipeline running on the FastAPI backend.
- **Knowledge_Graph**: Layer 3 — the Neo4j graph database storing concept nodes and typed relationship edges.
- **ChromaDB**: The vector database storing embeddings for all Knowledge_Graph nodes.
- **Dashboard**: Layer 4 — the React 18 + Vite frontend presenting all user-facing views.
- **API**: Layer 5 — the FastAPI REST API exposing all graph operations.
- **LLM**: Large Language Model — specifically Groq API running Llama 3.3 70B, used for concept and relationship extraction.
- **Concept_Node**: A graph node representing a single knowledge concept with properties: concept_id, name, domain, summary, source_url, created_at, last_seen, ease_factor, rep_interval, rep_count, forget_score.
- **Edge**: A directed, labelled relationship between two Concept_Nodes. Valid types: IS_PREREQUISITE_FOR, IS_SUBSET_OF, EXTENDS, CONTRADICTS, IS_USED_IN, CO_OCCURS_WITH.
- **SM2_Algorithm**: The SuperMemo SM-2 spaced repetition algorithm adapted for computing forget_score via exponential decay on each Concept_Node.
- **Forgetting_Threshold**: The forget_score value below which a Concept_Node is considered at risk of being forgotten by the user.
- **Digest**: The auto-generated daily learning summary produced each night by the Pipeline.
- **RAG**: Retrieval-Augmented Generation — hybrid retrieval combining ChromaDB vector similarity and Neo4j graph neighbourhood expansion to answer user queries.
- **Gap_Detector**: The feature that cross-references a pasted job description against the Knowledge_Graph to identify missing concepts.
- **Trafilatura**: Python library used for boilerplate removal and clean text extraction from raw HTML.
- **Whisper**: whisper.cpp — the local, on-device speech-to-text model used for voice note transcription.
- **D3_Canvas**: The D3.js force-directed graph visualisation rendered on the Dashboard.
- **Confidence_Score**: A float in [0, 1] assigned by the LLM to each extracted concept indicating extraction reliability.
- **Private_Page**: Any webpage the user has explicitly marked to exclude from capture.
- **Blocked_Domain**: A domain listed in the system's filter rules (social media, entertainment, banking, etc.) that is unconditionally excluded from capture.

---

## Requirements

### Requirement 1: Webpage Content Capture (FR-01)

**User Story:** As a user, I want the system to silently capture the text of webpages I read for more than 60 seconds, so that my browsing-based learning is automatically added to my knowledge base without any manual effort.

#### Acceptance Criteria

1. WHEN a user has been on a webpage for a duration exceeding the configured reading-time threshold, THE Extension SHALL extract the full visible text content of that page.
2. THE Extension SHALL use a default reading-time threshold of 60 seconds.
3. WHERE the user has configured a custom reading-time threshold, THE Extension SHALL apply that threshold in place of the default.
4. WHEN a page matches a Blocked_Domain rule, THE Extension SHALL skip capture for that page regardless of reading time.
5. WHEN a page has been marked as a Private_Page by the user, THE Extension SHALL skip capture for that page.
6. WHEN the user has paused tracking, THE Extension SHALL not capture any webpage content.
7. WHEN webpage text is captured, THE Extension SHALL store the raw text exclusively on the local machine.
8. IF text extraction from a webpage fails, THEN THE Extension SHALL log the failure with the page URL and timestamp without crashing.

---

### Requirement 2: YouTube Transcript Capture (FR-02)

**User Story:** As a user, I want transcripts of YouTube videos I watch past 50% completion to be automatically captured, so that video-based learning is included in my knowledge graph.

#### Acceptance Criteria

1. WHEN the user watches a YouTube video past 50% of its total duration, THE Extension SHALL trigger transcript retrieval for that video.
2. WHEN transcript retrieval is triggered, THE Extension SHALL fetch the full transcript via the youtube-transcript-api.
3. WHEN a YouTube video belongs to a non-educational category as determined by domain filter rules, THE Extension SHALL skip transcript capture for that video.
4. WHEN the user has paused tracking, THE Extension SHALL not capture any YouTube transcript.
5. WHEN a transcript is successfully retrieved, THE Extension SHALL store it as raw text exclusively on the local machine alongside the video URL and retrieval timestamp.
6. IF transcript retrieval fails for a video, THEN THE Extension SHALL log the failure with the video URL and timestamp without crashing.

---

### Requirement 3: PDF Ingestion (FR-03)

**User Story:** As a user, I want PDFs I open in my browser or on my desktop to be automatically ingested, so that document-based learning is captured without manual uploads.

#### Acceptance Criteria

1. WHEN a PDF file is opened in the Chrome browser, THE Extension SHALL detect the PDF and extract its text content page by page using PyMuPDF.
2. WHEN a PDF file is opened on the desktop file system, THE Desktop_Agent SHALL detect the file via the file watcher and extract its text content page by page using PyMuPDF.
3. WHEN the user has paused tracking, THE Capture_Engine SHALL not ingest any PDF.
4. WHEN PDF text is extracted, THE Capture_Engine SHALL store the raw text exclusively on the local machine alongside the file path or URL and extraction timestamp.
5. IF PDF text extraction fails for any page, THEN THE Capture_Engine SHALL log the failure with the file identifier, page number, and timestamp, and SHALL continue extracting remaining pages.

---

### Requirement 4: Voice Note Transcription (FR-04)

**User Story:** As a user, I want to record voice notes that are transcribed locally on my device without any cloud upload, so that spoken thoughts are captured privately in my knowledge base.

#### Acceptance Criteria

1. WHEN the user initiates a voice note recording through the Dashboard, THE System SHALL record the audio locally on the user's device.
2. WHEN a voice note recording is completed, THE System SHALL transcribe the audio using Whisper running locally.
3. THE System SHALL not transmit voice note audio or transcription data to any external server or cloud service.
4. WHEN transcription is complete, THE System SHALL store the resulting text exclusively on the local machine alongside the recording timestamp.
5. IF local Whisper transcription fails, THEN THE System SHALL log the failure with the recording timestamp and SHALL preserve the original audio file without deleting it.

---

### Requirement 5: Content Domain Filtering (FR-05)

**User Story:** As a user, I want to define which learning domains I care about so that only relevant content enters my knowledge graph and noise is excluded.

#### Acceptance Criteria

1. THE System SHALL maintain a configurable list of user-defined learning domains (e.g., "Machine Learning", "History", "Biology").
2. WHEN content is captured by the Capture_Engine, THE Capture_Engine SHALL tag each captured item with the most relevant user-defined domain based on the content's source URL and extracted text.
3. THE System SHALL enforce a Blocked_Domain list that unconditionally excludes social media platforms (Instagram, Twitter, Reddit), entertainment sites (Netflix), non-educational YouTube channels, password-management pages, banking pages, and personal-data pages.
4. WHEN the user adds a domain to the Blocked_Domain list, THE Capture_Engine SHALL immediately apply the updated list to all subsequent captures.
5. WHERE a captured item cannot be matched to any user-defined learning domain, THE Capture_Engine SHALL store the item as unclassified and present it in the Privacy Control Panel for user review.

---

### Requirement 6: One-Click Tracking Pause and Resume (FR-06)

**User Story:** As a user, I want to pause and resume all passive tracking with a single click, so that I can maintain control over when the system monitors my activity.

#### Acceptance Criteria

1. THE Dashboard SHALL display a clearly visible pause/resume tracking control at all times.
2. WHEN the user activates the pause control, THE Capture_Engine SHALL immediately stop capturing webpage content, YouTube transcripts, PDFs, and voice notes.
3. WHEN the user activates the resume control, THE Capture_Engine SHALL immediately resume all passive capture activities.
4. WHILE tracking is paused, THE Extension SHALL display a visual indicator in the browser toolbar confirming the paused state.
5. WHILE tracking is paused, THE System SHALL not enqueue any new items for the nightly Pipeline.

---

### Requirement 7: Configurable Nightly Processing Schedule (FR-07)

**User Story:** As a user, I want the AI processing pipeline to run automatically on a schedule I can configure, so that my knowledge graph is updated without requiring manual intervention.

#### Acceptance Criteria

1. THE Pipeline SHALL be triggered automatically by the APScheduler at the user-configured processing time.
2. THE System SHALL use a default processing time of 23:00 (11 PM) local time.
3. WHERE the user has configured a custom processing time, THE System SHALL schedule the Pipeline to trigger at that time instead of the default.
4. WHEN the Pipeline is triggered, THE System SHALL process all raw captured items enqueued since the last successful Pipeline run.
5. WHEN the Pipeline completes successfully, THE System SHALL record the completion timestamp and clear the processed items from the queue.
6. IF a Pipeline run fails mid-execution, THEN THE System SHALL log the failure with a full error trace, preserve all unprocessed items in the queue, and make the run resumable from the point of failure without data loss.
7. THE Pipeline SHALL process up to 50 captured items within 5 minutes under normal operating conditions.

---

### Requirement 8: Concept and Entity Extraction (FR-08)

**User Story:** As a developer and user, I want the pipeline to automatically identify key concepts and entities from captured text using an LLM, so that raw content is transformed into structured knowledge.

#### Acceptance Criteria

1. WHEN the Pipeline processes a captured text item, THE Pipeline SHALL send the cleaned, chunked text to the LLM for concept and entity extraction.
2. THE Pipeline SHALL split input text into overlapping chunks of 512 tokens before sending to the LLM.
3. THE LLM SHALL return a structured JSON response containing an array of extracted concepts, each with: name, domain, summary, and a Confidence_Score in the range [0, 1].
4. WHEN the LLM returns concept extraction results, THE Pipeline SHALL assign a Confidence_Score to each extracted concept.
5. IF the LLM returns a malformed or unparseable JSON response for a chunk, THEN THE Pipeline SHALL log the failure with the chunk identifier and SHALL continue processing remaining chunks.
6. THE Pipeline SHALL use Groq API with the Llama 3.3 70B model for all LLM inference.

---

### Requirement 9: Semantic Relationship Extraction (FR-09)

**User Story:** As a user, I want the pipeline to identify how concepts are related to each other, so that my knowledge graph captures the connections between ideas rather than just isolated facts.

#### Acceptance Criteria

1. WHEN concept extraction for a text chunk is complete, THE Pipeline SHALL send the extracted concepts to the LLM to identify semantic relationships between them.
2. THE LLM SHALL return relationships as structured JSON, each entry containing: source_concept, target_concept, and relationship_type.
3. THE Pipeline SHALL accept only the following relationship types: IS_PREREQUISITE_FOR, IS_SUBSET_OF, EXTENDS, CONTRADICTS, IS_USED_IN, CO_OCCURS_WITH.
4. IF the LLM returns a relationship with an unrecognised relationship_type, THEN THE Pipeline SHALL discard that relationship and log a warning.
5. WHEN relationships are extracted, THE Pipeline SHALL use them as Edge definitions when updating the Knowledge_Graph.

---

### Requirement 10: Entity Resolution and Deduplication (FR-10)

**User Story:** As a user, I want the system to merge duplicate concepts like "ML" and "Machine Learning" into a single node, so that my knowledge graph is clean and coherent.

#### Acceptance Criteria

1. WHEN new concepts are extracted during a Pipeline run, THE Pipeline SHALL perform entity resolution before inserting any new Concept_Node into the Knowledge_Graph.
2. THE Pipeline SHALL use string normalisation and LLM-assisted semantic matching to detect concepts that refer to the same entity (e.g., "ML" and "Machine Learning").
3. WHEN two concepts are resolved as duplicates, THE Pipeline SHALL merge them into a single Concept_Node, preserving all source URLs, timestamps, and edge relationships from both.
4. WHEN a merge occurs, THE Pipeline SHALL log the merged concept names and the resulting canonical Concept_Node identifier.
5. THE Pipeline SHALL not create a new Concept_Node for a concept that resolves to an existing node in the Knowledge_Graph.

---

### Requirement 11: Knowledge Graph Storage in Neo4j (FR-11)

**User Story:** As a user, I want my knowledge to be stored as a typed graph of nodes and labelled edges in Neo4j, so that complex relationships between concepts can be queried and visualised efficiently.

#### Acceptance Criteria

1. WHEN the Pipeline completes concept and relationship extraction for a batch, THE Pipeline SHALL write all new Concept_Nodes and Edges to the Neo4j Knowledge_Graph.
2. THE Knowledge_Graph SHALL store each Concept_Node with properties: concept_id, name, domain, summary, source_url, created_at, last_seen, ease_factor, rep_interval, rep_count, forget_score.
3. THE Knowledge_Graph SHALL store each Edge with a label matching one of the six valid Edge types defined in the Glossary.
4. THE Knowledge_Graph SHALL support at least 10,000 Concept_Nodes without degradation in query response time.
5. WHEN a Concept_Node is updated during a subsequent Pipeline run (new source or updated summary), THE Pipeline SHALL update the node's last_seen timestamp and any changed properties without creating a duplicate node.
6. IF a write operation to Neo4j fails during a Pipeline run, THEN THE Pipeline SHALL retry the operation up to three times before logging the failure and continuing with remaining items.

---

### Requirement 12: Vector Embedding Generation in ChromaDB (FR-12)

**User Story:** As a user, I want every concept node to have a vector embedding stored in ChromaDB, so that semantic similarity search powers the conversational query interface.

#### Acceptance Criteria

1. WHEN a new Concept_Node is written to the Knowledge_Graph, THE Pipeline SHALL generate a vector embedding for that node's name and summary.
2. THE Pipeline SHALL store each embedding in ChromaDB with the corresponding concept_id as the document identifier.
3. WHEN a Concept_Node's summary is updated during a subsequent Pipeline run, THE Pipeline SHALL regenerate and overwrite the embedding in ChromaDB.
4. THE ChromaDB collection SHALL be stored exclusively on the local machine.
5. IF embedding generation or ChromaDB write fails for a node, THEN THE Pipeline SHALL log the failure with the concept_id and SHALL continue processing remaining nodes.

---

### Requirement 13: SM-2 Forgetting Score Computation (FR-13)

**User Story:** As a user, I want the system to calculate how likely I am to have forgotten each concept using a spaced repetition algorithm, so that the system can proactively remind me of fading knowledge.

#### Acceptance Criteria

1. WHEN the nightly Pipeline run completes graph updates, THE Pipeline SHALL recalculate the forget_score for every Concept_Node in the Knowledge_Graph.
2. THE Pipeline SHALL compute forget_score using the SM-2 spaced repetition algorithm with exponential decay based on each node's ease_factor, rep_interval, rep_count, and last_seen timestamp.
3. THE Pipeline SHALL update the ease_factor, rep_interval, rep_count, and forget_score properties on each Concept_Node after computation.
4. THE forget_score SHALL be a float value in the range [0, 1], where values closer to 0 indicate higher risk of forgetting.
5. WHEN a Concept_Node is encountered again in new captured content, THE Pipeline SHALL treat the re-encounter as a successful review event and recalculate SM-2 parameters accordingly.

---

### Requirement 14: Proactive Forgetting Threshold Surfacing (FR-14)

**User Story:** As a user, I want the system to proactively notify me of concepts I am likely to forget, so that I can review them before the knowledge fades.

#### Acceptance Criteria

1. WHEN the nightly Pipeline run completes SM-2 scoring, THE Pipeline SHALL identify all Concept_Nodes whose forget_score has fallen below the Forgetting_Threshold.
2. THE Dashboard SHALL display the list of Concept_Nodes crossing the Forgetting_Threshold in the Daily Digest Panel.
3. WHEN a user views a Concept_Node surfaced by the threshold alert, THE System SHALL record the view as a review event and update the node's SM-2 parameters.
4. THE System SHALL allow the user to configure the Forgetting_Threshold value from the Dashboard settings.
5. WHILE the Daily Digest Panel is displayed, THE Dashboard SHALL visually distinguish threshold-crossing nodes from newly learned nodes.

---

### Requirement 15: Daily Learning Digest Generation (FR-15)

**User Story:** As a user, I want an automatically generated summary of what I learned today to appear each morning, so that I can quickly review yesterday's knowledge additions without manually browsing the graph.

#### Acceptance Criteria

1. WHEN the nightly Pipeline run completes all graph updates and SM-2 scoring, THE Pipeline SHALL invoke the LLM to generate a Digest summarising the day's learning activity.
2. THE Digest SHALL include: a summary of new concepts added, new Edges created, domains covered, and a list of Concept_Nodes approaching the Forgetting_Threshold.
3. THE Pipeline SHALL store the generated Digest with a date timestamp in persistent local storage.
4. WHEN the user opens the Dashboard, THE Dashboard SHALL display the most recent Digest in the Daily Digest Panel.
5. THE Dashboard SHALL retain and allow access to Digests from at least the past 30 days.
6. IF Digest generation fails during a Pipeline run, THEN THE Pipeline SHALL log the failure and SHALL still complete all other Pipeline steps successfully.

---

### Requirement 16: Conversational RAG Query Interface (FR-16)

**User Story:** As a user, I want to ask natural language questions about my knowledge graph and receive answers with cited sources, so that I can explore and retrieve what I have learned conversationally.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a Conversational Chat Interface where the user can submit natural language queries.
2. WHEN the user submits a query, THE API SHALL perform hybrid RAG retrieval by combining ChromaDB vector similarity search and Neo4j graph neighbourhood expansion.
3. WHEN RAG retrieval completes, THE API SHALL pass the retrieved context and user query to the LLM to generate a response.
4. WHEN a response is generated, THE API SHALL include source citations identifying the Concept_Nodes and source URLs that contributed to the answer.
5. THE API SHALL return the response to the Dashboard within 3 seconds of the user submitting the query.
6. WHEN the user asks a follow-up question in the same session, THE System SHALL maintain conversational context across the session.
7. IF no relevant content is found in the Knowledge_Graph for a query, THEN THE API SHALL return a response informing the user that no relevant knowledge was found, rather than hallucinating an answer.

---

### Requirement 17: Real-Time Animated Knowledge Graph Visualisation (FR-17)

**User Story:** As a user, I want to see my entire knowledge graph as an animated, interactive visual canvas, so that I can intuitively explore connections between concepts.

#### Acceptance Criteria

1. THE Dashboard SHALL render the Knowledge_Graph as a full-screen force-directed graph using D3.js.
2. THE D3_Canvas SHALL size each Concept_Node proportionally to its importance score derived from its edge count and rep_count.
3. THE D3_Canvas SHALL colour each Concept_Node according to its domain.
4. THE D3_Canvas SHALL display Edge labels showing the relationship type on hover.
5. THE D3_Canvas SHALL animate node additions and edge changes in real time via WebSocket updates from the API.
6. THE D3_Canvas SHALL render up to 500 Concept_Nodes at a sustained frame rate of at least 30 frames per second.
7. WHEN the user clicks a Concept_Node on the D3_Canvas, THE Dashboard SHALL display the node's full details including name, domain, summary, source_url, created_at, last_seen, and forget_score.
8. THE D3_Canvas SHALL support pan, zoom, and node-drag interactions.

---

### Requirement 18: Privacy Control Panel with Node and Source Deletion (FR-18)

**User Story:** As a user, I want full visibility into everything the system has captured and the ability to permanently delete any item, so that I remain in complete control of my personal data.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a Privacy Control Panel listing every captured item including webpage captures, YouTube transcripts, PDF extractions, and voice note transcriptions.
2. THE Privacy Control Panel SHALL display for each item: source URL or file path, capture timestamp, capture type, and processing status.
3. WHEN the user selects a single Concept_Node for deletion in the Privacy Control Panel, THE System SHALL permanently remove that node and all its Edges from the Knowledge_Graph and ChromaDB within a single user action.
4. WHEN the user selects a source item for deletion in the Privacy Control Panel, THE System SHALL permanently remove all Concept_Nodes and Edges derived from that source, along with the raw captured text, in a single user action.
5. WHEN a deletion is performed, THE System SHALL confirm the deletion to the user with a count of nodes and edges removed.
6. WHEN a deletion is performed, THE System SHALL not retain any copy of the deleted data on the local machine.
7. IF a deletion operation fails partially, THEN THE System SHALL report which items were not deleted and SHALL not present the deletion as successful.

---

### Requirement 19: Knowledge Gap Detection Against Job Descriptions (FR-19)

**User Story:** As a user, I want to paste a job description and see which required skills I have not yet learned, so that I can identify and fill gaps in my knowledge for career preparation.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a Gap_Detector panel where the user can paste a job description as plain text.
2. WHEN the user submits a job description, THE API SHALL extract the required skills and technologies from the job description using the LLM.
3. WHEN skills are extracted, THE API SHALL cross-reference each extracted skill against the Knowledge_Graph to determine whether a matching Concept_Node exists.
4. THE Dashboard SHALL display a gap report showing: skills present in the graph, skills absent from the graph (gaps), and the user's forget_score for present skills.
5. WHEN the gap report is displayed, THE Dashboard SHALL allow the user to click any gap skill to trigger a web search or view related nodes already in the graph.
6. IF no Concept_Nodes match any extracted skills, THEN THE Dashboard SHALL display a message indicating that none of the required skills have been captured yet.

---

### Requirement 20: Weekly Learning Report Export as PDF (FR-20)

**User Story:** As a user, I want to download a weekly report of my knowledge growth as a PDF, so that I have an offline record of my learning progress.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a control to generate and download the weekly learning report as a PDF file.
2. WHEN the report generation is triggered, THE API SHALL compile the following for the past 7 days: number of new Concept_Nodes added per day, number of new Edges created, domains covered, top 10 concepts by edge count, and a list of concepts that crossed the Forgetting_Threshold.
3. THE API SHALL format the compiled data into a structured PDF document and return it as a downloadable file.
4. WHEN the PDF is downloaded, THE System SHALL name the file using the format: psb-weekly-report-YYYY-MM-DD.pdf where the date is the report generation date.
5. IF PDF generation fails, THEN THE API SHALL return an error message to the Dashboard and SHALL not serve a corrupt or incomplete file.

---

### Requirement 21: Local Data Storage and Privacy (NFR-01, NFR-02, NFR-11)

**User Story:** As a user, I want all my captured content and knowledge data to stay on my local machine and never be transmitted to external servers, so that my personal learning activity remains completely private.

#### Acceptance Criteria

1. THE Capture_Engine SHALL store all raw captured content (webpage text, YouTube transcripts, PDF text, voice transcriptions) exclusively on the user's local machine.
2. THE System SHALL not transmit raw captured content, Concept_Node data, or user behavioural data to any external server except for LLM inference API calls (Groq API) which receive only anonymised text chunks.
3. THE System SHALL store all API keys (Groq API key, Neo4j credentials) in local environment variables and SHALL never embed them in frontend source code or Git-tracked files.
4. THE Privacy Control Panel SHALL provide the user with full visibility into every captured item before and after processing.
5. THE System SHALL provide the user with a clear audit log showing which items have been processed by the Pipeline and which are awaiting processing.

---

### Requirement 22: Performance — Pipeline, Query, and Rendering (NFR-04, NFR-05, NFR-06)

**User Story:** As a user, I want the system to process my learning data quickly, respond to queries promptly, and render the graph smoothly, so that the experience feels responsive and not frustrating.

#### Acceptance Criteria

1. THE Pipeline SHALL process up to 50 captured items within 5 minutes during a nightly run under normal operating conditions.
2. THE API SHALL return a conversational RAG query response to the Dashboard within 3 seconds of receiving the query.
3. THE D3_Canvas SHALL render up to 500 Concept_Nodes at a sustained minimum of 30 frames per second on a standard consumer laptop.
4. THE Knowledge_Graph SHALL return Cypher query results for common graph traversal operations within 2 seconds when the graph contains up to 10,000 Concept_Nodes.
5. WHEN the Pipeline processing time for a batch exceeds 5 minutes, THE System SHALL log a performance warning with the batch size and elapsed time.

---

### Requirement 23: Chrome Extension Minimal Performance Impact (NFR-07, NFR-12)

**User Story:** As a user, I want the Chrome extension to be invisible in terms of page load performance and browser permissions, so that it does not slow down my browsing or feel intrusive.

#### Acceptance Criteria

1. THE Extension SHALL not increase page load time by more than 5% as measured by the browser's performance timing API.
2. THE Extension SHALL request only the minimum browser permissions required to perform passive content capture, reading-time measurement, and YouTube progress tracking.
3. THE Extension SHALL not inject scripts that block the main browser thread during content extraction.
4. THE Extension SHALL defer content extraction to run after the page's load event has fired.

---

### Requirement 24: Fault Tolerance and Pipeline Resumability (NFR-08)

**User Story:** As a user, I want failed pipeline runs to be automatically logged and resumable without any data loss, so that a transient error never corrupts or destroys my knowledge base.

#### Acceptance Criteria

1. WHEN a Pipeline run encounters an unhandled exception, THE System SHALL log the full exception trace with a timestamp and the identifier of the item being processed.
2. WHEN a Pipeline run fails, THE System SHALL preserve all unprocessed items in the capture queue so that they are included in the next Pipeline run.
3. WHEN a Pipeline run is resumed after failure, THE System SHALL skip items that were successfully processed in the previous interrupted run and process only the remaining items.
4. THE System SHALL expose the status of the most recent Pipeline run (success, failed, in-progress) in the Dashboard.
5. IF Neo4j or ChromaDB becomes unavailable during a Pipeline run, THEN THE Pipeline SHALL abort the current batch, log the connectivity failure, and preserve all unwritten data for the next run.

---

### Requirement 25: Onboarding and Time-to-Value (NFR-09)

**User Story:** As a new user, I want to install the system and see a populated knowledge graph within 15 minutes, so that I can immediately understand the value of the product without a long setup process.

#### Acceptance Criteria

1. WHEN a first-time user completes the setup flow, THE Dashboard SHALL display a pre-loaded sample Knowledge_Graph demonstrating nodes, edges, domains, and the D3_Canvas visualisation.
2. THE System SHALL guide the user through environment setup (Neo4j, ChromaDB, Groq API key, Extension install) via a step-by-step onboarding flow in the Dashboard.
3. THE onboarding flow SHALL complete from first launch to a populated sample graph within 15 minutes on a standard consumer laptop with a stable internet connection.
4. THE Dashboard SHALL provide a "clear sample data" action that removes all pre-loaded sample nodes before the user's real learning activity begins.

---

### Requirement 26: Graph Export (Layer 5 — Extras)

**User Story:** As a user, I want to export my entire knowledge graph as a JSON file or shareable image, so that I can back up my data or share my learning map with others.

#### Acceptance Criteria

1. THE Dashboard SHALL provide controls to export the full Knowledge_Graph in JSON format and as a static image.
2. WHEN the user triggers a JSON export, THE API SHALL serialise all Concept_Nodes and Edges into a well-structured JSON document and return it as a downloadable file.
3. WHEN the user triggers an image export, THE Dashboard SHALL render the current D3_Canvas view as a PNG image and offer it as a download.
4. WHEN a JSON export file is generated, THE System SHALL name the file using the format: psb-graph-export-YYYY-MM-DD.json.
5. IF graph export fails, THEN THE API SHALL return a descriptive error message to the Dashboard without serving a partial or corrupt file.

---

### Requirement 27: REST API Exposure (Layer 5 — Extras)

**User Story:** As a developer, I want all graph operations exposed as a documented REST API, so that I can integrate the knowledge graph with other tools and automate interactions programmatically.

#### Acceptance Criteria

1. THE API SHALL expose documented REST endpoints for all core graph operations including: query graph, add node, delete node, delete source, get digest, get pipeline status, and trigger pipeline run.
2. THE API SHALL be implemented using FastAPI and SHALL auto-generate an OpenAPI specification accessible at the /docs endpoint.
3. WHEN an API request is made with invalid parameters, THE API SHALL return a 422 Unprocessable Entity response with a descriptive validation error message.
4. WHEN an API request references a resource that does not exist, THE API SHALL return a 404 Not Found response.
5. THE API SHALL authenticate all non-read requests using a local API key stored in environment variables.

---

### Requirement 28: Groq Prompt Playground (Layer 5 — Extras)

**User Story:** As a developer, I want an internal panel to test and iterate on the LLM extraction prompts without triggering a full pipeline run, so that I can quickly improve extraction quality.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a Groq Prompt Playground panel accessible only in developer mode.
2. WHEN the developer submits a prompt and sample text in the Playground, THE API SHALL send the prompt to the Groq API and display the raw JSON response in the Dashboard.
3. THE Playground SHALL allow the developer to edit the concept extraction prompt, the relationship extraction prompt, and the Digest generation prompt independently.
4. WHEN the developer saves a prompt in the Playground, THE System SHALL persist the updated prompt and use it in all subsequent Pipeline runs.
5. THE Playground SHALL display the Groq API token usage and latency for each test request.

---

### Requirement 29: Future Scope — Low Priority Extensions

**User Story:** As a product owner, I want the system architecture to accommodate future extensions without requiring major rewrites, so that the platform can grow beyond the initial capstone scope.

#### Acceptance Criteria

1. WHERE a mobile application is developed in the future, THE API SHALL expose all necessary endpoints for a React Native client to consume graph and digest data.
2. WHERE AI spaced review sessions are implemented, THE System SHALL use existing SM-2 parameters on Concept_Nodes to auto-generate review quizzes targeting nodes with the lowest forget_scores.
3. WHERE a team knowledge graph feature is added, THE Knowledge_Graph schema SHALL support a user_id property on all Concept_Nodes to partition data by user.
4. WHERE an offline local LLM mode is enabled, THE Pipeline SHALL accept a configurable LLM provider endpoint so that Groq API calls can be replaced with a local Ollama endpoint without code changes.
5. WHERE browser history import is implemented, THE System SHALL accept a browser history export file and process historical URLs through the same capture and Pipeline flow as live captures.
6. WHERE Obsidian or Notion import is implemented, THE System SHALL accept exported Markdown or JSON files from those tools and ingest them through the existing Pipeline ingestion flow.
