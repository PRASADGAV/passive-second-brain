# 🎯 Frontend Implementation Prompt for IDE Agent

## Project: Passive Second Brain — Knowledge Graph 3D Carousel UI

---

## 📌 DESIGN REFERENCE

**Primary Visual Reference:** https://experiment.obys.agency/ (Obys® Experiment Space)

Study this site carefully. The hero features a **3D cylindrical carousel** of cards/images arranged in a circle using CSS 3D transforms. The user's screenshot confirms: cards orbit in a horizontal ring, each card tilted at a calculated `rotateY` angle with `translateZ` pushing them outward from the center. The carousel is draggable to rotate. The aesthetic is editorial, ultra-clean, large bold typography, generous whitespace.

**You MUST replicate this EXACT 3D carousel mechanics for the Knowledge Graph visualization.** Do NOT use a flat force-directed D3 graph. The nodes ARE the carousel cards.

---

## 🎨 THEME & AESTHETIC (Apply to the Obys Layout)

| Element | Specification |
|---------|--------------|
| **Background** | Deep midnight `#030712` with subtle radial gradient glow `#0a0f1d` → `#030712` |
| **Primary Accent** | Neon cyan `#22d3ee` |
| **Secondary Accent** | Purple `#a855f7` |
| **Typography (UI)** | Inter or Outfit via Google Fonts |
| **Typography (Metrics/Code)** | JetBrains Mono |
| **Card Style** | Glassmorphism — `backdrop-filter: blur(12px)`, `background: rgba(10, 15, 29, 0.6)`, `border: 1px solid rgba(34, 211, 238, 0.15)`, subtle box-shadow glow |
| **Node Glow** | Halo brightness scales with memory freshness (`forget_score`). Fresh = bright cyan glow. Fading = dim/dull. |
| **Color Coding** | Each knowledge domain gets a unique accent color (ML = cyan, System Design = purple, Web Dev = emerald, etc.) |
| **Feel** | Premium, cinematic, fluid Framer Motion transitions, ambient pulsing lights, cursor-responsive micro-interactions |

---

## 🚀 CORE FEATURE: 3D CYLINDRICAL KNOWLEDGE GRAPH CAROUSEL

### Layout Architecture (CRITICAL — Copy Obys Exactly)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Live Header Bar: Pipeline ●  |  WS ●  |  Concepts: 1,240  Links: 8,932]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                    ┌─────────────────────────────┐                          │
│                    │                             │                          │
│     ┌──────┐      │      KNOWLEDGE GRAPH        │      ┌──────┐            │
│     │ Node │      │                             │      │ Node │            │
│     │ Card │  ╲   │   [ 3D CYLINDER CAROUSEL ]  │   ╱  │ Card │            │
│     │ (ML) │   ╲  │                             │  ╱   │(Web) │            │
│     └──┬───┘    ╲ │  Cards orbit on a cylinder  │ ╱    └──┬───┘            │
│        │         ╲│  Drag to rotate left/right  │╱        │                │
│     translateZ    │                             │     translateZ           │
│     rotateY(45°)  │  ←── perspective: 1200px ──→│  rotateY(-45°)           │
│                   │                             │                          │
│                    │   Center = empty / focal    │                          │
│                    │   point with subtle glow    │                          │
│                    └─────────────────────────────┘                          │
│                                                                             │
│  [Search/Filter Bar ───────────────────────────────────────] [Export ▼]      │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Chat Panel]  |  [Ingestion Tabs]  |  [Digest]  |  [Gaps]  |  [Privacy]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3D Carousel Technical Specification

**CSS 3D Cylinder Setup:**
```css
.carousel-container {
  perspective: 1200px;
  perspective-origin: 50% 50%;
  height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.carousel-cylinder {
  position: relative;
  width: 300px;  /* card width */
  height: 380px; /* card height */
  transform-style: preserve-3d;
  transition: transform 0.1s ease-out; /* smooth drag */
}

.node-card {
  position: absolute;
  width: 300px;
  height: 380px;
  left: 0;
  top: 0;
  /* Glassmorphism */
  background: rgba(10, 15, 29, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(34, 211, 238, 0.15);
  border-radius: 16px;
  padding: 24px;
  /* Each card positioned via inline styles from JS */
  transform: rotateY(${angle}deg) translateZ(${radius}px);
  backface-visibility: hidden; /* or visible with opacity fade */
}
```

**JavaScript Positioning Logic (React/Vue/whatever framework):**
```javascript
// Arrange N nodes in a cylinder
const NODE_COUNT = nodes.length;
const ANGLE_STEP = 360 / NODE_COUNT;
const RADIUS = 450; // distance from center

nodes.forEach((node, i) => {
  const angle = i * ANGLE_STEP;
  node.transform = `rotateY(${angle}deg) translateZ(${RADIUS}px)`;
  // Optional: slight vertical offset for visual interest
  node.verticalOffset = Math.sin(angle * Math.PI / 180) * 20;
});
```

**Drag-to-Rotate Interaction:**
- On `mousedown`/`touchstart`: record starting X position and current rotation
- On `mousemove`/`touchmove`: calculate delta X, apply `carouselCylinder.style.transform = rotateY(${currentRotation + delta * sensitivity}deg)`
- On `mouseup`/`touchend`: snap to nearest card angle with spring animation (Framer Motion or CSS transition)
- Optional: support mouse wheel to rotate
- Optional: auto-rotate slowly when idle (ambient motion)

**Node Card Content (each carousel card):**
- **Top:** Domain tag (colored pill) + Memory freshness indicator (small glowing dot: green=fresh, yellow=fading, red=critical)
- **Center:** Concept name (large bold text, 2-line clamp)
- **Bottom:** 
  - Forget score decay bar (thin horizontal progress bar, cyan → red gradient)
  - Connection count (small: "12 links")
  - Source favicon + domain
- **Hover state:** Card lifts toward viewer (`translateZ` increases by 60px), border glow intensifies, reveals "Review" button
- **Click state:** Opens Node Detail Drawer (slides in from right)

---

## 📦 ALL MODULES TO BUILD

### MODULE 1: Live Workspace Header Bar
- **Pipeline Status Dot:** `IDLE` (green `#22c55e`), `RUNNING` (pulsing cyan `#22d3ee`), `FAILED` (red `#ef4444`)
- **WebSocket Sync Dot:** `LIVE` (green) / `OFFLINE` (gray) with pulse animation when connected
- **Metrics:** `Connected Concepts` | `Knowledge Links` | `Domains Covered` — all in JetBrains Mono, updating in real-time via WebSocket
- **Typography:** Large bold "SECOND BRAIN" wordmark centered (inspired by Obys' massive centered type)

### MODULE 2: 3D Cylindrical Knowledge Graph (THE HERO)
- Implemented exactly as specified in the 3D Carousel Technical Specification above
- **Search/Filter Bar** below carousel: real-time input that filters which nodes appear in the carousel (smooth fade in/out with Framer Motion `AnimatePresence`)
- **Export Controls:** `📥 Export JSON` (triggers `GET /api/graph/export/json`) and `📷 Export PNG` (html2canvas of carousel viewport)
- **Node Detail Drawer** (right-side slide-in, 480px wide):
  - Concept name, domain badge, full summary
  - Forget score bar with numeric value
  - Origin source URL (clickable, with favicon)
  - 2-hop connected concepts list (fetched from `GET /api/graph/neighbourhood/{id}?hops=2`)
  - "Review Concept" button → `POST /api/memory/review/{concept_id}`
  - Close with X or click outside

### MODULE 3: Conversational Hybrid RAG Chat Panel
- **Layout:** Slide-up panel or dedicated section below the graph, or toggleable sidebar
- **Message Bubbles:** User (dark gray right-aligned), AI (glassmorphism left-aligned with cyan left border)
- **Source Citations:** Below each AI answer, horizontal row of pill-shaped citation chips:
  - Each chip: Concept name | Domain tag | mini source link
  - Hover chip → highlight corresponding node in carousel (pulse glow)
  - Click chip → open that node's detail drawer
- **Latency Badge:** Small monospace badge showing response time (e.g., `1.2s`, `53ms`) in top-right of AI bubble
- **Input:** Fixed bottom input with send button, glassmorphism styling
- **Clear Context Button:** Resets session, `POST /api/chat` with new session

### MODULE 4: Multi-Source Ingestion & Capture Center
- **Tabbed Interface** (5 tabs, glassmorphism tab bar):
  1. **🌐 Web URL:** Input field + "Capture" button → `POST /api/ingest/url`
  2. **▶️ YouTube:** Input field + "Capture" button → `POST /api/ingest/youtube`
  3. **📄 PDF Dropzone:** Drag-and-drop area with `border: 2px dashed rgba(34,211,238,0.3)`, file preview, upload → `POST /api/ingest/pdf`
  4. **🎤 Voice Note:** Record button (hold to record, visual waveform animation), stop → `POST /api/ingest/voice`
  5. **📝 Quick Text:** Markdown textarea with preview toggle → `POST /api/ingest/text`
- **Ingest Progress:** Each tab shows a progress bar/spinner while uploading/processing
- **Success State:** Brief toast notification, new node appears in carousel with entrance animation

### MODULE 5: Daily Learning Digest & Spaced Repetition Panel
- **Nightly Digest Card:** Glassmorphism card showing:
  - "Today's Learning" heading with date
  - AI-generated summary paragraph
  - Stats: concepts learned count, edges formed, domains covered (fetched from `GET /api/digest/today`)
- **Fading Memory Alerts Bar:** Horizontal scrollable row of cards for concepts with `forget_score > 0.7` (from `GET /api/memory/alerts?threshold=0.7`)
  - Each alert card: concept name, forget score percentage bar (red), "Review Now" button
  - Click "Review Now" → `POST /api/memory/review/{concept_id}`, card fades out, success toast
- **30-Day History Timeline:** Vertical timeline with dots, each day clickable to view that digest (`GET /api/digest/history?days=30`)

### MODULE 6: Knowledge Gap & Career Path Analyzer
- **Input:** Large textarea for job description or target skills → `POST /api/gaps`
- **Results Dashboard:** Three-column layout after analysis:
  - **✅ Existing (Green):** Pill list of concepts already in graph matching target
  - **⚠️ Missing Prerequisites (Red/Yellow):** Card list of concepts needed, sorted by priority
  - **📋 Learning Plan Roadmap:** Numbered vertical step list generated by LLM, each step expandable

### MODULE 7: Privacy & Security Panel
- **Global Tracking Toggle:** Large iOS-style switch. Paused state = amber glow. Active = cyan glow.
- **Domain Blocklist:** Input to add domains + list of blocked domains with remove (×) buttons
- **Data Erasure Section:** 
  - "Delete Concept" search → confirmation modal
  - "Purge by Source URL" input → shows count of affected concepts → confirm purge

### MODULE 8: Weekly PDF Analytics Report
- **Weekly Progress Card:** Glassmorphism card with:
  - Concept growth sparkline chart (last 7 days)
  - Top 3 domains studied (horizontal bar chart)
  - Forgetting rate trend line (green = improving, red = worsening)
- **Download PDF Button:** Triggers `GET /api/report/weekly`, shows download progress, opens blob download

---

## 🔌 API INTEGRATION CONTRACT

Connect all frontend state to these endpoints:

| Feature | Method | Endpoint | Notes |
|---------|--------|----------|-------|
| Get all nodes | GET | `/api/graph/nodes?skip=0&limit=500` | Feed into carousel |
| Get neighborhood | GET | `/api/graph/neighbourhood/{id}?hops=2` | Node detail drawer |
| Graph stats | GET | `/api/graph/stats` | Header metrics |
| Seed data | POST | `/api/graph/seed` | Onboarding only |
| Export JSON | GET | `/api/graph/export/json` | File download |
| Ingest URL | POST | `/api/ingest/url` | `{ url: string }` |
| Ingest YouTube | POST | `/api/ingest/youtube` | `{ url: string }` |
| Ingest Text | POST | `/api/ingest/text` | `{ content: string }` |
| Ingest PDF | POST | `/api/ingest/pdf` | `multipart/form-data` |
| Ingest Voice | POST | `/api/ingest/voice` | `multipart/form-data`, audio blob |
| Chat | POST | `/api/chat` | `{ query: string, session_id?: string }` |
| Memory alerts | GET | `/api/memory/alerts?threshold=0.7` | Spaced repetition |
| Review concept | POST | `/api/memory/review/{concept_id}` | Reset decay |
| Today's digest | GET | `/api/digest/today` | Daily summary |
| Digest history | GET | `/api/digest/history?days=30` | Timeline data |
| Gap analysis | POST | `/api/gaps` | `{ job_description: string }` |
| Weekly report | GET | `/api/report/weekly` | Returns PDF blob |

**WebSocket:** `ws://localhost:8081/ws`
- Listen for: `node_added`, `edge_added`, `pipeline_status`
- On `node_added`: Add new card to carousel with entrance animation (scale 0→1 + rotate in)
- On `edge_added`: Flash connection line between two existing cards briefly
- On `pipeline_status`: Update header pipeline dot

---

## 🎭 ANIMATION & INTERACTION REQUIREMENTS

Use **Framer Motion** for all animations. Do NOT use plain CSS transitions for complex sequences.

| Interaction | Animation Spec |
|------------|----------------|
| **Page Load** | Header fades in (0.3s), then carousel cylinder assembles — cards fly in from Z-depth with stagger (0.05s each), landing in cylinder positions |
| **Carousel Drag** | Real-time `rotateY` update, 1:1 with mouse delta, `ease-out` release |
| **Carousel Snap** | Spring physics: stiffness 120, damping 20, snap to nearest card angle |
| **Card Hover** | Card `translateZ` +60px, border glow intensifies to `rgba(34,211,238,0.5)`, inner content slightly scales (1.02) |
| **Card Click** | Brief scale-down (0.95) then drawer slides in from right (spring, stiffness 300, damping 30) |
| **Node Detail Drawer** | Slides from right (x: 100% → 0), backdrop overlay fades in (`rgba(0,0,0,0.5)`), close with swipe-right or X |
| **Filter Search** | `AnimatePresence`: non-matching cards fade out + scale down + blur, matching cards remain, carousel repositions smoothly |
| **New Node via WS** | Card scales from 0 → 1 with cyan glow pulse, enters cylinder at calculated position, neighboring cards slide to make room |
| **New Edge via WS** | Brief glowing line (SVG or CSS) drawn between two cards, fades over 1.5s |
| **Toast Notifications** | Slide in from top-right, glassmorphism, auto-dismiss 4s |
| **Tab Switch** | Content crossfade (0.2s), active tab indicator slides (layout animation) |
| **Loading States** | Skeleton screens with animated shimmer gradient (`linear-gradient(90deg, transparent, rgba(34,211,238,0.05), transparent)`) |
| **Memory Decay Bar** | Animated width with color transition (cyan → yellow → red) based on forget_score |
| **Pipeline Status** | IDLE = solid green dot. RUNNING = pulsing cyan ring animation (scale 1→1.5, opacity 1→0, infinite). FAILED = solid red with subtle shake |

---

## 📁 RECOMMENDED COMPONENT STRUCTURE

```
src/
├── components/
│   ├── layout/
│   │   ├── HeaderBar.tsx              # Live metrics + status dots
│   │   └── MainLayout.tsx             # Grid layout: header + carousel + panels
│   ├── graph/
│   │   ├── Carousel3D.tsx             # 3D cylinder container (preserve-3d)
│   │   ├── NodeCard.tsx               # Individual glassmorphism card
│   │   ├── CarouselControls.tsx       # Search, Export buttons
│   │   └── NodeDetailDrawer.tsx       # Right slide-in drawer
│   ├── chat/
│   │   ├── ChatPanel.tsx              # Full chat interface
│   │   ├── MessageBubble.tsx          # User/AI bubbles
│   │   ├── SourceCitationPill.tsx     # Clickable citation chip
│   │   └── ChatInput.tsx              # Bottom input bar
│   ├── ingestion/
│   │   ├── IngestionCenter.tsx        # Tab container
│   │   ├── UrlCaptureTab.tsx
│   │   ├── YoutubeCaptureTab.tsx
│   │   ├── PdfDropzone.tsx
│   │   ├── VoiceRecorder.tsx
│   │   └── TextNoteTab.tsx
│   ├── digest/
│   │   ├── DailyDigestCard.tsx
│   │   ├── MemoryAlertBar.tsx         # Horizontal scrolling alerts
│   │   ├── MemoryAlertCard.tsx
│   │   └── DigestTimeline.tsx         # 30-day vertical timeline
│   ├── gaps/
│   │   ├── GapAnalyzerInput.tsx
│   │   └── GapResultsDashboard.tsx
│   ├── privacy/
│   │   ├── TrackingToggle.tsx
│   │   ├── DomainBlocklist.tsx
│   │   └── DataErasurePanel.tsx
│   ├── report/
│   │   ├── WeeklyProgressCard.tsx
│   │   └── PdfDownloadButton.tsx
│   └── shared/
│       ├── GlassCard.tsx              # Reusable glassmorphism wrapper
│       ├── GlowDot.tsx                # Status indicator dots
│       ├── AnimatedCounter.tsx        # Count-up numbers
│       ├── Toast.tsx                  # Notification system
│       └── SpringButton.tsx           # Button with press spring
├── hooks/
│   ├── useWebSocket.ts                # ws://localhost:8081/ws handler
│   ├── useGraphData.ts                # Fetch + cache graph nodes
│   ├── useCarouselDrag.ts             # Mouse/touch drag logic for rotateY
│   └── useApi.ts                      # Generic fetch wrapper with loading/error
├── types/
│   └── index.ts                       # Node, Edge, Digest, Message interfaces
├── lib/
│   ├── utils.ts                       # cn() helper, angle calculations
│   └── api.ts                         # Axios/fetch client with baseURL
└── App.tsx                            # Main app with all panels
```

---

## ⚙️ TECH STACK (Recommended)

- **Framework:** React 18+ with TypeScript
- **Styling:** Tailwind CSS + custom CSS for 3D transforms
- **Animation:** Framer Motion (critical for all transitions)
- **Icons:** Lucide React
- **Charts (for reports):** Recharts or Chart.js
- **PDF Export (client-side):** html2canvas for PNG export
- **HTTP Client:** Axios or native fetch
- **State:** React Query (TanStack Query) for server state, Zustand for UI state

---

## ✅ ACCEPTANCE CHECKLIST

- [ ] 3D cylinder carousel renders all graph nodes with correct `rotateY` + `translateZ` positioning
- [ ] Drag-to-rotate works smoothly with spring snap to nearest card
- [ ] Glassmorphism cards match the dark cyber-cinematic theme exactly
- [ ] Node hover lifts card toward viewer with intensified glow
- [ ] Node click opens detail drawer with neighborhood data from API
- [ ] WebSocket connects and handles `node_added`/`edge_added`/`pipeline_status` in real-time
- [ ] Search filter smoothly shows/hides cards with AnimatePresence
- [ ] Chat panel shows messages with source citation pills that highlight graph nodes
- [ ] All 5 ingestion tabs work and call correct API endpoints
- [ ] Memory alerts display correctly for `forget_score > 0.7`, Review button resets decay
- [ ] Gap analyzer accepts job description and displays three-column results
- [ ] Weekly report section shows charts and triggers PDF download
- [ ] All animations feel fluid, premium, and Obys-level polished
- [ ] Fully responsive (carousel scales down on mobile, becomes swipeable)

---

## 🚨 CRITICAL INSTRUCTIONS

1. **The 3D cylinder carousel is NON-NEGOTIABLE.** Do not implement a standard 2D force-directed graph. Every node must be a physical card in a 3D CSS cylinder, exactly like Obys Experiment Space.
2. **Study the reference site.** If possible, inspect the Obys site with DevTools to understand their exact CSS 3D values (perspective, translateZ distance, card sizing).
3. **The dark theme + glassmorphism + neon accents must be applied to the Obys layout.** Do not make it a white/minimal site — transform the Obys 3D mechanics into your cyber-cinematic aesthetic.
4. **All API calls must be real.** Use the exact endpoints provided. Handle loading, error, and empty states with skeletons and friendly messages.
5. **Performance:** Use `will-change: transform` on carousel. Limit visible cards or use `backface-visibility: hidden` if rendering >50 nodes. Consider virtualizing the cylinder for large graphs.

---

**Build this as a single-page React application with all modules. The 3D Knowledge Graph Carousel is the hero centerpiece — everything else supports it.**
