# 🧠 Passive Second Brain — Complete Frontend Description

> Use this document as reference when improving the UI with Claude or any other AI tool. It contains screenshots, component structure, file paths, and detailed descriptions of every screen.

---

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| React | 19.2.7 | UI framework |
| Vite | 8.1.1 | Build tool & dev server |
| D3.js | 7.9.0 | Force-directed graph visualization |
| Framer Motion | 12.42.2 | Animations & transitions |
| Axios | 1.18.1 | HTTP client for API calls |
| Vanilla CSS | — | Glassmorphic dark theme design system |

---

## Design System Overview

The entire app uses a **dark glassmorphic theme** defined in [index.css](file:///c:/Users/prasa/Desktop/Mega/frontend/src/index.css) (19KB, ~600 lines). Key design tokens:

| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | Deep dark navy | Page background |
| `--bg-card` | Semi-transparent dark | Card/panel backgrounds |
| `--accent-indigo` | Indigo/blue | Primary buttons, highlights |
| `--accent-cyan` | Cyan | Edge count, secondary accents |
| `--accent-emerald` | Green | Success states, live indicator |
| `--accent-rose` | Red/pink | Danger buttons, offline indicator |
| `--text-primary` | White/light | Main text |
| `--text-secondary` | Muted gray | Secondary text |
| `--text-muted` | Darker gray | Placeholder text |

---

## Project File Map

```
frontend/
├── index.html                              # Entry HTML (SEO meta tags, emoji favicon)
├── vite.config.js                          # Vite config with /api proxy → localhost:8081
├── package.json                            # Dependencies
├── src/
│   ├── main.jsx                            # React root mount
│   ├── App.jsx                             # App shell: top nav + dashboard layout
│   ├── App.css                             # App-specific overrides
│   ├── index.css                           # Global design system (19KB)
│   ├── api/
│   │   └── client.js                       # Axios API client (all endpoints)
│   ├── hooks/
│   │   ├── useGraph.js                     # Graph data state management
│   │   ├── useWebSocket.js                 # WebSocket connection hook
│   │   └── useChat.js                      # Chat state management
│   └── components/
│       ├── GraphCanvas.jsx                 # D3.js force-directed graph (9KB)
│       ├── NodeDetail.jsx                  # Node detail overlay panel
│       ├── ChatPanel.jsx                   # RAG Q&A chat interface
│       ├── DigestPanel.jsx                 # Daily digest + fading concepts
│       ├── WeeklyReport.jsx                # Weekly report PDF download
│       ├── InputPanel.jsx                  # URL/Text/PDF ingestion forms
│       ├── GapAnalyser.jsx                 # Job description gap analysis
│       ├── PrivacyPanel.jsx                # Concept deletion controls
│       ├── PromptPlayground.jsx            # Dev-mode prompt testing
│       └── Onboarding.jsx                  # First-time setup wizard (11KB)
```

---

## Layout Architecture

The dashboard uses a **two-column layout**:

```
┌──────────────────────────────────────────────────────┐
│  🧠 Passive Second Brain  │ stats │ pipeline │ live │ ← Top Navigation Bar
├────────────────────────────┬─────────────────────────┤
│                            │ 💬 📊 📅 ➕ 🎯 🔒 🛠️  │ ← Sidebar Tab Bar
│     D3.js Force-Directed   │                         │
│     Knowledge Graph        │   Active Tab Content    │
│     (SVG Canvas)           │   (scrollable panel)    │
│                            │                         │
│  ┌─────────────────────┐   │                         │
│  │ Search + Export btns │   │                         │
│  └─────────────────────┘   │                         │
│                            │                         │
├────────────────────────────┴─────────────────────────┤
```

---

## Screenshots & Component Details

### 1. Main Dashboard (Graph + Chat Tab)

![Dashboard with Chat tab](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/dashboard_chat_1785219335940.png)

**Top Navigation Bar** — [App.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/App.jsx#L112-L157)
- Logo: `🧠 Passive Second Brain`
- Stats: `100 nodes`, `40 edges`, `5 domains`
- Pipeline status indicator (idle/running/failed with animated dot)
- WebSocket live/offline indicator (green/red dot)
- Refresh button `↻`

**Graph Canvas (left)** — [GraphCanvas.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/GraphCanvas.jsx)
- D3.js force-directed graph rendered in an SVG canvas
- Nodes are colored circles sized by connection count
- Edges are semi-transparent lines between nodes
- Hover shows node label; click opens NodeDetail overlay
- Controls overlay: Search bar `🔍`, Export JSON `📥`, Export PNG `📷`
- Supports zoom, pan, and drag interactions

**Chat Panel (right)** — [ChatPanel.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/ChatPanel.jsx)
- Title: `💬 Ask your Second Brain`
- Description text explaining RAG grounded search
- Input field at bottom with "Send" button
- Responses show cited sources from the knowledge graph

---

### 2. Digest Tab

![Digest Tab](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/dashboard_digest_1785219374688.png)

**Component**: [DigestPanel.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/DigestPanel.jsx)

- Shows daily digest summary from the nightly pipeline
- Empty state: "No digest today — pipeline hasn't run yet"
- Fading Concepts section: Shows concepts with high forget_score (SM-2 spaced repetition)
- When populated, shows: new concepts learned, connections made, source breakdown

---

### 3. Report Tab

![Report Tab](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/dashboard_report_1785219404793.png)

**Component**: [WeeklyReport.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/WeeklyReport.jsx)

- Title: `📅 Weekly Learning Report`
- Download PDF button (streams from `/report/weekly` endpoint)
- Empty state: "No activity in the last 7 days"
- When populated, the backend generates a PDF with daily ingestion charts, top concepts, and memory alerts

---

### 4. Add Tab (Content Ingestion)

![Add Tab](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/dashboard_add_1785219462059.png)

**Component**: [InputPanel.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/InputPanel.jsx)

Three input sections:
1. **🔗 Add URL** — Text input for article/webpage URLs + "Add" button
2. **📝 Add Text** — Textarea for pasting notes/highlights + "Submit" button
3. **📄 Upload PDF** — File picker for PDF research documents

Each section calls the corresponding ingest API endpoint.

---

### 5. Gaps Tab (Knowledge Gap Analysis)

![Gaps Tab](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/dashboard_gaps_1785219480865.png)

**Component**: [GapAnalyser.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/GapAnalyser.jsx)

- Title: `🎯 Knowledge Gap Detector`
- Description explaining the job-description matching feature
- Large textarea for pasting a job description
- "Analyse Gaps" button sends to Groq LLM for comparison
- Results show matched skills (in your graph) vs missing skills

---

### 6. Privacy Tab

![Privacy Tab](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/dashboard_privacy_1785219500787.png)

**Component**: [PrivacyPanel.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/PrivacyPanel.jsx)

- Title: `🔒 Privacy Controls`
- Scrollable list of all 100 concepts in the knowledge graph
- Each concept shows: name, domain, source URL
- Per-concept controls:
  - `✕` red danger button — delete single concept
  - `🗑` ghost button — delete all concepts from that source URL

---

### 7. Playground Tab (Developer Mode)

![Playground Tab](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/dashboard_play_full_1785219619848.png)

**Component**: [PromptPlayground.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/PromptPlayground.jsx)

- Title: `🛠️ Prompt Playground`
- Notice: "Playground is only accessible in DEVELOPER_MODE"
- Prompt template selector dropdown (extract, digest, gaps)
- System Prompt Editor textarea (editable)
- "Save & Apply Prompt Changes" button
- Test Input textarea for sample text
- "⚡ Run Inference Test" button
- Results panel shows LLM output

---

### 8. Node Detail Overlay

**Component**: [NodeDetail.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/NodeDetail.jsx)

- Appears as a slide-in overlay when clicking a graph node
- Shows: concept name, domain, summary, source URL, forget_score
- Close button to dismiss

---

### 9. Onboarding Wizard

![Onboarding Wizard](C:/Users/prasa/.gemini/antigravity-ide/brain/df1b5d17-013e-49f7-8d87-31cd5adbae9e/initial_onboarding_1785219302953.png)

**Component**: [Onboarding.jsx](file:///c:/Users/prasa/Desktop/Mega/frontend/src/components/Onboarding.jsx) (11KB)

4-step guided setup wizard:
1. **Connect Backend Services** — Checks Neo4j & ChromaDB connectivity
2. **Set API Key** — Configure the PSB API key for authentication
3. **Initial Content** — Add your first URL or text content
4. **Completion** — Summary and "Get Started" button

---

## API Client Summary

All API calls are defined in [client.js](file:///c:/Users/prasa/Desktop/Mega/frontend/src/api/client.js):

| API Module | Endpoints | Used By |
|---|---|---|
| `graphAPI` | getNodes, getNeighbourhood, getStats, createConcept, deleteConcept, deleteSource, exportJSON | GraphCanvas, PrivacyPanel, useGraph |
| `ingestAPI` | url, youtube, text, pdf | InputPanel, Onboarding |
| `chatAPI` | send | ChatPanel, useChat |
| `memoryAPI` | getAlerts, review | DigestPanel |
| `digestAPI` | getToday, getHistory | DigestPanel |
| `pipelineAPI` | getStatus, trigger | App (top nav) |
| `gapAPI` | analyse | GapAnalyser |
| `reportAPI` | getWeeklyReport | WeeklyReport |
| `playgroundAPI` | getPrompts, savePrompt, testPrompt | PromptPlayground |

---

## Custom Hooks

| Hook | File | Purpose |
|---|---|---|
| `useGraph` | [useGraph.js](file:///c:/Users/prasa/Desktop/Mega/frontend/src/hooks/useGraph.js) | Fetches nodes/edges/stats, provides addNode/addEdge/refresh |
| `useWebSocket` | [useWebSocket.js](file:///c:/Users/prasa/Desktop/Mega/frontend/src/hooks/useWebSocket.js) | Manages WebSocket connection, reconnection, event listeners |
| `useChat` | [useChat.js](file:///c:/Users/prasa/Desktop/Mega/frontend/src/hooks/useChat.js) | Manages chat message history and send/receive flow |
