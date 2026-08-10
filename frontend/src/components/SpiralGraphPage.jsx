import {
  useEffect, useRef, useState, useCallback, Suspense, lazy,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as THREE from 'three';
import { useGraph } from '../hooks/useGraph';
import { useChat } from '../hooks/useChat';
import { graphAPI, memoryAPI } from '../api/client';
import { computeSpiralLayout } from '../utils/computeSpiralLayout';

const ForceGraph3D = lazy(() => import('react-force-graph-3d'));

// ── Domain colour map ─────────────────────────────────────────────────────────
const DOMAIN_COLORS = {
  'Machine Learning': '#818cf8', 'Web Development': '#38bdf8',
  'System Design': '#fbbf24',   'DSA': '#34d399',
  'DevOps': '#f87171',          'Data Science': '#c084fc',
  'Database': '#f472b6',        'API Design': '#2dd4bf',
  'Cloud': '#fb923c',           'General': '#94a3b8',
};
const nodeColor = n => DOMAIN_COLORS[n.domain] || '#94a3b8';

// ── Helpers (copied from BrainGraphPage for self-containment) ─────────────────
function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function retentionPct(fs) { return Math.round((1 - (fs || 0)) * 100); }
function sourceIcon(url = '') {
  if (!url) return '📄';
  if (url.includes('youtube') || url.includes('youtu.be')) return '▶';
  if (url.includes('.pdf') || url.includes('pdf')) return '📕';
  if (url.includes('github')) return '⌥';
  return '🔗';
}
function repStage(ri) {
  if (!ri || ri < 3) return { label: 'New',       color: '#f87171' };
  if (ri < 7)        return { label: 'Learning',  color: '#fbbf24' };
  if (ri < 30)       return { label: 'Reviewing', color: '#34d399' };
  return               { label: 'Mastered',  color: '#818cf8' };
}

// ── NodeCard popup (same as BrainGraphPage) ───────────────────────────────────
function NodeCard({ node, onClose, onDelete, onUpdate, onReview }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isEditing,     setIsEditing]     = useState(false);
  const [editName,      setEditName]      = useState(node.name    || '');
  const [editDomain,    setEditDomain]    = useState(node.domain  || '');
  const [editSummary,   setEditSummary]   = useState(node.summary || '');
  const [saving,        setSaving]        = useState(false);
  const stage = repStage(node.rep_interval);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await onUpdate?.(node.concept_id, {
        name: editName.trim(), domain: editDomain.trim() || 'General',
        summary: editSummary.trim(),
      });
      setIsEditing(false);
    } finally { setSaving(false); }
  };
  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await onDelete?.(node.concept_id);
    onClose();
  };

  return (
    <motion.div className="nc-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose}>
      <motion.div className="nc-card"
        initial={{ opacity: 0, scale: 0.88, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 12 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        onClick={e => e.stopPropagation()} style={{ '--accent': nodeColor(node) }}>
        <div className="nc-card__bar" style={{ background: nodeColor(node) }} />
        <button className="nc-card__close" onClick={onClose}>✕</button>
        <div className="nc-card__header">
          <div className="nc-card__domain" style={{ color: nodeColor(node) }}>{node.domain || 'General'}</div>
          <div className="nc-card__stage" style={{ color: stage.color }}>● {stage.label}</div>
        </div>
        {isEditing ? (
          <div className="nc-card__edit-block">
            <label className="nc-card__edit-label">Name</label>
            <input className="nc-card__edit-input" value={editName} onChange={e => setEditName(e.target.value)} />
            <label className="nc-card__edit-label">Domain</label>
            <input className="nc-card__edit-input" value={editDomain} onChange={e => setEditDomain(e.target.value)} />
            <label className="nc-card__edit-label">Summary</label>
            <textarea className="nc-card__edit-input nc-card__edit-textarea"
              value={editSummary} onChange={e => setEditSummary(e.target.value)} rows={3} />
            <div className="nc-card__edit-actions">
              <button className="nc-card__btn nc-card__btn--primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="nc-card__btn" onClick={() => setIsEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <><div className="nc-card__name">{node.name}</div>
          <p className="nc-card__summary">{node.summary || '—'}</p></>
        )}
        <div className="nc-card__retention-row">
          <span className="nc-card__ret-label">Memory retention</span>
          <span className="nc-card__ret-pct">{retentionPct(node.forget_score)}%</span>
        </div>
        <div className="nc-card__ret-track">
          <motion.div className="nc-card__ret-fill"
            initial={{ width: 0 }} animate={{ width: `${retentionPct(node.forget_score)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.15 }}
            style={{ background: nodeColor(node) }} />
        </div>
        <div className="nc-card__grid">
          {[
            ['Studied',   formatDate(node.created_at), formatTime(node.created_at)],
            ['Last seen', formatDate(node.last_seen),   formatTime(node.last_seen)],
            ['Reviews',   node.rep_count ?? 0,          'times'],
            ['Next in',   node.rep_interval ?? 1,       'days'],
            ['Ease',      (node.ease_factor ?? 2.5).toFixed(1), 'factor'],
            ['Forget',    ((node.forget_score ?? 0) * 100).toFixed(1), '%'],
          ].map(([l, v, s]) => (
            <div key={l} className="nc-card__cell">
              <div className="nc-card__cell-label">{l}</div>
              <div className="nc-card__cell-value">{v}</div>
              <div className="nc-card__cell-sub">{s}</div>
            </div>
          ))}
        </div>
        {node.source_url && (
          <a className="nc-card__source" href={node.source_url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}>
            <span className="nc-card__source-icon">{sourceIcon(node.source_url)}</span>
            <span className="nc-card__source-url">
              {node.source_url.replace(/^https?:\/\//, '').slice(0, 55)}
            </span>
            <span className="nc-card__source-arrow">↗</span>
          </a>
        )}
        <div className="nc-card__actions">
          <button className="nc-card__btn nc-card__btn--primary" onClick={() => onReview?.(node.concept_id)}>↺ Review Now</button>
          {!isEditing && <button className="nc-card__btn" onClick={() => setIsEditing(true)}>✎ Edit</button>}
          <button className="nc-card__btn nc-card__btn--danger"
            style={confirmDelete ? { background: '#ef4444', color: '#fff' } : {}}
            onClick={handleDelete}>
            {confirmDelete ? '⚠ Confirm?' : '✕ Delete'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Chat sidebar ──────────────────────────────────────────────────────────────
function ChatSidebar({ onConceptClick }) {
  const { messages, loading, send, clear } = useChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  const handleSend = () => { if (input.trim() && !loading) { send(input.trim()); setInput(''); } };
  const onKey = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
  return (
    <div className="bg-chat">
      <div className="bg-chat__header">
        <div>
          <div className="bg-chat__eyebrow">Hybrid RAG</div>
          <div className="bg-chat__title">SECOND BRAIN</div>
        </div>
        {messages.length > 0 && <button className="bg-chat__clear" onClick={clear} data-cursor="hover">Clear</button>}
      </div>
      <div className="bg-chat__messages">
        {messages.length === 0 && (
          <div className="bg-chat__empty">
            <div className="bg-chat__empty-title">Ask anything</div>
            <div className="bg-chat__empty-sub">Answers grounded in your captured knowledge.</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`bg-chat__bubble bg-chat__bubble--${msg.role}`}>
            <p>{msg.content}</p>
            {msg.citations?.length > 0 && (
              <div className="bg-chat__citations">
                {msg.citations.map((c, j) => (
                  <button key={j} className="bg-chat__cite" onClick={() => onConceptClick?.(c)} data-cursor="hover">
                    ◎ {c.name}
                  </button>
                ))}
              </div>
            )}
            {msg.latency_ms && <div className="bg-chat__latency">{msg.latency_ms.toFixed(0)}ms</div>}
          </div>
        ))}
        {loading && <div className="bg-chat__typing">Thinking…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="bg-chat__input-row">
        <input className="bg-chat__input" placeholder="Ask your Second Brain…"
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} />
        <button className="bg-chat__send" onClick={handleSend}
          disabled={loading || !input.trim()} data-cursor="hover">↑</button>
      </div>
    </div>
  );
}

// ── Time ring overlay (HTML overlay over the canvas) ─────────────────────────
function TimeBandOverlay({ timeBands, fgRef, graphSize }) {
  const [projected, setProjected] = useState([]);

  useEffect(() => {
    if (!fgRef.current || !timeBands.length || !graphSize.w) return;

    const project = () => {
      try {
        const camera = fgRef.current.camera?.();
        const renderer = fgRef.current.renderer?.();
        if (!camera || !renderer) return;

        const w = graphSize.w, h = graphSize.h;
        const result = timeBands.map(band => {
          // Project the point (0, HELIX_RADIUS + 30, z) — top of the ring
          const v = new THREE.Vector3(0, 190, band.z);
          v.project(camera);
          const x = (v.x * 0.5 + 0.5) * w;
          const y = (1 - (v.y * 0.5 + 0.5)) * h;
          const visible = v.z < 1 && x > -20 && x < w + 20 && y > 0 && y < h;
          return { ...band, sx: x, sy: y, visible };
        });
        setProjected(result);
      } catch { /* camera not ready */ }
    };

    const id = setInterval(project, 120);
    return () => clearInterval(id);
  }, [timeBands, fgRef, graphSize]);

  return (
    <div className="sg-band-overlay" style={{ width: graphSize.w, height: graphSize.h }}>
      {projected.filter(b => b.visible).map((b, i) => (
        <div key={i} className="sg-band-label"
          style={{ left: b.sx, top: b.sy }}>
          {b.label}
        </div>
      ))}
    </div>
  );
}

// ── Build graph data from spiral layout ───────────────────────────────────────
function buildSpiralData(nodes, edges, positions, selectedDomains, searchTerm) {
  const filtered = nodes.filter(n => {
    const matchSearch = !searchTerm.trim() ||
      `${n.name} ${n.domain} ${n.summary}`.toLowerCase().includes(searchTerm.toLowerCase());
    const matchDomain = selectedDomains.size === 0 || selectedDomains.has(n.domain || 'General');
    return matchSearch && matchDomain;
  });

  const filteredIds = new Set(filtered.map(n => n.concept_id));

  const graphNodes = filtered.map(n => {
    const pos = positions.get(n.concept_id) || { x: 0, y: 0, z: 0 };
    const ageDays = n.created_at
      ? (Date.now() - new Date(n.created_at).getTime()) / 86400000
      : 999;
    const isRecent = ageDays < 7;
    return {
      id:           n.concept_id,
      name:         n.name,
      domain:       n.domain,
      summary:      n.summary,
      forget_score: n.forget_score  ?? 0,
      rep_count:    n.rep_count     ?? 0,
      rep_interval: n.rep_interval  ?? 1,
      ease_factor:  n.ease_factor   ?? 2.5,
      source_url:   n.source_url,
      created_at:   n.created_at,
      last_seen:    n.last_seen,
      concept_id:   n.concept_id,
      // Fixed positions — disable force simulation
      fx: pos.x, fy: pos.y, fz: pos.z,
      x:  pos.x, y:  pos.y, z:  pos.z,
      // Visual: larger for recent + well-connected nodes
      val: Math.max(1.5, (n.edge_count || 1) * 0.8 + (isRecent ? 2 : 0)),
      isRecent,
      isFading: (n.forget_score || 0) > 0.6,
    };
  });

  const graphLinks = (edges || [])
    .filter(e => e.source_id && e.target_id &&
      filteredIds.has(e.source_id) && filteredIds.has(e.target_id))
    .map(e => ({
      source:     e.source_id,
      target:     e.target_id,
      type:       e.type || '',
      confidence: e.confidence ?? 1,
    }));

  return { nodes: graphNodes, links: graphLinks };
}

// ── MAIN SpiralGraphPage ──────────────────────────────────────────────────────
export default function SpiralGraphPage({ onBack, onSwitchView }) {
  const { nodes, edges, stats, loading, error, refresh } = useGraph();
  const [SpriteText,      setSpriteText]      = useState(null);
  const [selectedNode,    setSelectedNode]    = useState(null);
  const [searchTerm,      setSearchTerm]      = useState('');
  const [selectedDomains, setSelectedDomains] = useState(new Set());
  const [chatOpen,        setChatOpen]        = useState(false);
  const [graphSize,       setGraphSize]       = useState({ w: 0, h: 0 });
  const [layout,          setLayout]          = useState({ positions: new Map(), timeBands: [], dateRange: null });
  const [autoRotate,      setAutoRotate]      = useState(true);

  const graphWrapRef = useRef(null);
  const fgRef        = useRef(null);
  const rotAngle     = useRef(0);

  // Load SpriteText
  useEffect(() => {
    import('three-spritetext').then(m => setSpriteText(() => m.default));
  }, []);

  // Compute spiral layout whenever nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      setLayout(computeSpiralLayout(nodes));
    }
  }, [nodes]);

  // Measure container
  useEffect(() => {
    if (!graphWrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setGraphSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(graphWrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Ctrl+K search focus
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector('.sg-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-rotate — slow orbit around Z-axis, drift towards newest nodes
  useEffect(() => {
    if (!autoRotate) return;
    const id = setInterval(() => {
      if (!fgRef.current || selectedNode) return;
      rotAngle.current += 0.12;
      const r = 520;
      fgRef.current.cameraPosition(
        { x: r * Math.sin(rotAngle.current * Math.PI / 180),
          y: 80,
          z: r * Math.cos(rotAngle.current * Math.PI / 180) + 300 },
        { x: 0, y: 0, z: 300 },
        0
      );
    }, 33);
    return () => clearInterval(id);
  }, [autoRotate, selectedNode]);

  const uniqueDomains = [...new Set(nodes.map(n => n.domain || 'General'))].sort();
  const toggleDomain = d => setSelectedDomains(prev => {
    const next = new Set(prev);
    next.has(d) ? next.delete(d) : next.add(d);
    return next;
  });

  const graphData = buildSpiralData(nodes, edges, layout.positions, selectedDomains, searchTerm);
  const filteredCount = graphData.nodes.length;

  // ── Node click ───────────────────────────────────────────────────────────
  const handleNodeClick = useCallback(node => {
    setAutoRotate(false);
    setSelectedNode({
      concept_id:   node.id,
      name:         node.name,
      domain:       node.domain,
      summary:      node.summary,
      forget_score: node.forget_score,
      rep_count:    node.rep_count,
      rep_interval: node.rep_interval,
      ease_factor:  node.ease_factor,
      source_url:   node.source_url,
      created_at:   node.created_at,
      last_seen:    node.last_seen,
      isRecent:     node.isRecent,
    });
    if (fgRef.current) {
      const dist = 100;
      const distR = 1 + dist / Math.hypot(node.x, node.y, node.z || 1);
      fgRef.current.cameraPosition(
        { x: node.x * distR, y: node.y * distR, z: (node.z || 0) * distR + 30 },
        { x: node.x, y: node.y, z: node.z || 0 },
        700
      );
    }
  }, []);

  const handleCitationClick = useCallback(citation => {
    const match = nodes.find(n =>
      n.concept_id === citation.concept_id ||
      n.name?.toLowerCase() === citation.name?.toLowerCase()
    );
    if (match) setSelectedNode(match);
  }, [nodes]);

  const handleDeleteNode  = async id => { await graphAPI.deleteConcept(id); setSelectedNode(null); refresh(); };
  const handleUpdateNode  = async (id, data) => { await graphAPI.updateConcept(id, data); refresh(); setSelectedNode(p => p ? { ...p, ...data } : null); };
  const handleReviewNode  = async id => { await memoryAPI.review(id); refresh(); };

  // ── nodeThreeObject: sphere + label + glow ring for fading nodes ──────────
  const nodeThreeObject = useCallback(node => {
    if (!SpriteText) return null;
    const group = new THREE.Group();

    // Text label
    const sprite = new SpriteText(node.name);
    sprite.color      = nodeColor(node);
    sprite.textHeight = node.isRecent ? 6 : 4.5;
    sprite.fontFace   = 'JetBrains Mono, monospace';
    sprite.fontWeight = '600';
    sprite.center.y   = -0.9;
    group.add(sprite);

    // Pulsing glow ring for fading (forget_score > 0.6) nodes
    if (node.isFading) {
      const ringGeo  = new THREE.RingGeometry(5, 7, 32);
      const ringMat  = new THREE.MeshBasicMaterial({
        color: 0xf87171, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }

    // Bright outline ring for recently-learned nodes
    if (node.isRecent) {
      const rimGeo = new THREE.RingGeometry(4.5, 5.5, 32);
      const rimMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(nodeColor(node)),
        side: THREE.DoubleSide, transparent: true, opacity: 0.8,
      });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      group.add(rim);
    }

    return group;
  }, [SpriteText]);

  // ── Edge colour: gradient by type ───────────────────────────────────────
  const linkColor = useCallback(link => {
    const typeColors = {
      IS_PREREQUISITE_FOR: 'rgba(129,140,248,0.35)',
      EXTENDS:             'rgba(56,189,248,0.35)',
      IS_SUBSET_OF:        'rgba(52,211,153,0.35)',
      CO_OCCURS_WITH:      'rgba(251,191,36,0.35)',
      IS_USED_IN:          'rgba(192,132,252,0.35)',
      DERIVED_FROM:        'rgba(251,146,60,0.35)',
    };
    return typeColors[link.type] || 'rgba(255,255,255,0.12)';
  }, []);

  return (
    <div className="bg-shell sg-shell">
      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <header className="bg-topbar">
        <button className="bg-topbar__back" onClick={onBack} data-cursor="hover">← Dashboard</button>
        <div className="bg-topbar__center">
          <span className="bg-topbar__title">TEMPORAL SPIRAL</span>
          {stats && (
            <>
              <span className="bg-topbar__stat">{stats.node_count ?? 0} concepts</span>
              <span className="bg-topbar__stat">{stats.edge_count ?? 0} edges</span>
              {layout.dateRange && (
                <span className="bg-topbar__stat">
                  {layout.dateRange.earliest.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  {' → '}
                  {layout.dateRange.latest.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                </span>
              )}
            </>
          )}
        </div>
        <div className="bg-topbar__right">
          <button className="bg-topbar__btn" onClick={onSwitchView} data-cursor="hover">
            ◈ Force View
          </button>
          <button className={`bg-topbar__btn ${autoRotate ? 'is-active' : ''}`}
            onClick={() => setAutoRotate(v => !v)} data-cursor="hover">
            {autoRotate ? '⏸ Pause' : '▶ Rotate'}
          </button>
          <button className={`bg-topbar__btn ${chatOpen ? 'is-active' : ''}`}
            onClick={() => setChatOpen(v => !v)} data-cursor="hover">
            {chatOpen ? 'Hide Chat' : 'Show Chat'}
          </button>
          <button className="bg-topbar__btn" onClick={refresh} data-cursor="hover">↻ Refresh</button>
        </div>
      </header>

      {/* ── MAIN ─────────────────────────────────────────────────────────── */}
      <div className="bg-main">
        <div className="bg-graph-wrap" ref={graphWrapRef}>

          {/* Controls */}
          <div className="bg-controls">
            <div className="bg-controls__search-wrap">
              <input className="bg-controls__search sg-search"
                placeholder="Search concepts… (Ctrl+K)"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              {searchTerm && (
                <button className="bg-controls__clear" onClick={() => setSearchTerm('')}>✕</button>
              )}
              <span className="bg-controls__count">{filteredCount}/{nodes.length}</span>
            </div>
            {uniqueDomains.length > 0 && (
              <div className="bg-controls__domains">
                {uniqueDomains.map(d => (
                  <button key={d}
                    className={`bg-controls__domain ${selectedDomains.has(d) ? 'is-active' : ''}`}
                    onClick={() => toggleDomain(d)}
                    style={selectedDomains.has(d) ? {
                      background: DOMAIN_COLORS[d] || '#94a3b8',
                      borderColor: DOMAIN_COLORS[d] || '#94a3b8', color: '#fff',
                    } : {}} data-cursor="hover">
                    {d}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Time-axis legend */}
          <div className="sg-axis-label sg-axis-label--old">← Earlier</div>
          <div className="sg-axis-label sg-axis-label--new">Recent →</div>

          {loading && (
            <div className="bg-loading">
              <div className="bg-loading__ring" />
              <div className="bg-loading__text">Computing spiral layout…</div>
            </div>
          )}
          {error && (
            <div className="bg-loading">
              <div className="bg-loading__text" style={{ color: '#f87171' }}>Connection error</div>
              <button className="bg-loading__retry" onClick={refresh}>Retry</button>
            </div>
          )}

          {!loading && !error && graphSize.w > 0 && (
            <Suspense fallback={<div className="bg-loading"><div className="bg-loading__ring" /></div>}>
              <ForceGraph3D
                ref={fgRef}
                graphData={graphData}
                width={graphSize.w}
                height={graphSize.h}
                backgroundColor="#04040c"
                // Disable force simulation — positions are fixed
                d3AlphaDecay={1}
                d3VelocityDecay={1}
                cooldownTicks={0}
                nodeColor={nodeColor}
                nodeVal={n => n.val}
                nodeOpacity={n => 1 - (n.forget_score || 0) * 0.5}
                nodeResolution={14}
                nodeLabel={() => ''}
                nodeThreeObjectExtend={true}
                nodeThreeObject={SpriteText ? nodeThreeObject : undefined}
                linkColor={linkColor}
                linkWidth={l => Math.max(0.3, (l.confidence || 1) * 0.8)}
                linkDirectionalParticles={1}
                linkDirectionalParticleWidth={1.2}
                linkDirectionalParticleColor={l => {
                  const src = graphData.nodes.find(n => n.id === (l.source?.id ?? l.source));
                  return src ? nodeColor(src) : '#ffffff';
                }}
                linkDirectionalParticleSpeed={0.004}
                onNodeClick={handleNodeClick}
                onBackgroundClick={() => { setSelectedNode(null); setAutoRotate(true); }}
                enableNavigationControls={true}
                enableNodeDrag={false}
              />
            </Suspense>
          )}

          {/* Time band labels overlay */}
          {!loading && layout.timeBands.length > 0 && graphSize.w > 0 && (
            <TimeBandOverlay
              timeBands={layout.timeBands}
              fgRef={fgRef}
              graphSize={graphSize}
            />
          )}

          {/* Domain legend */}
          {uniqueDomains.length > 0 && (
            <div className="bg-legend">
              {uniqueDomains.slice(0, 8).map(d => (
                <div key={d} className="bg-legend__item">
                  <span className="bg-legend__dot" style={{ background: DOMAIN_COLORS[d] || '#94a3b8' }} />
                  <span>{d}</span>
                </div>
              ))}
            </div>
          )}

          {/* Visual key */}
          <div className="sg-key">
            <div className="sg-key__item">
              <span className="sg-key__ring sg-key__ring--recent" />
              <span>Learned recently</span>
            </div>
            <div className="sg-key__item">
              <span className="sg-key__ring sg-key__ring--fading" />
              <span>Needs review</span>
            </div>
            <div className="sg-key__item">
              <span className="sg-key__dot sg-key__dot--big" />
              <span>Well-connected</span>
            </div>
            <div className="sg-key__item">
              <span className="sg-key__dot sg-key__dot--dim" />
              <span>Fading memory</span>
            </div>
          </div>

          {/* NodeCard popup */}
          <AnimatePresence>
            {selectedNode && (
              <NodeCard key={selectedNode.concept_id} node={selectedNode}
                onClose={() => { setSelectedNode(null); setAutoRotate(true); }}
                onDelete={handleDeleteNode}
                onUpdate={handleUpdateNode}
                onReview={handleReviewNode}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Chat sidebar */}
        <AnimatePresence>
          {chatOpen && (
            <motion.div className="bg-chat-wrap"
              initial={{ width: 0, opacity: 0 }} animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              <ChatSidebar onConceptClick={handleCitationClick} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
