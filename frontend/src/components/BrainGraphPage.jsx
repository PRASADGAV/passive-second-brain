import { useEffect, useRef, useState, useCallback, Suspense, lazy } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGraph } from '../hooks/useGraph';
import { useChat } from '../hooks/useChat';
import { graphAPI, memoryAPI } from '../api/client';

// Lazy-load heavy WebGL deps
const ForceGraph3D = lazy(() => import('react-force-graph-3d'));

// ── Domain colour map ─────────────────────────────────────────────────────────
const DOMAIN_COLORS = {
  'Machine Learning': '#818cf8',
  'Web Development':  '#38bdf8',
  'System Design':    '#fbbf24',
  'DSA':              '#34d399',
  'DevOps':           '#f87171',
  'Data Science':     '#c084fc',
  'Database':         '#f472b6',
  'API Design':       '#2dd4bf',
  'Cloud':            '#fb923c',
  'General':          '#94a3b8',
};
const nodeColor = node => DOMAIN_COLORS[node.domain] || '#94a3b8';

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatTime(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function retentionPct(forget_score) {
  return Math.round((1 - (forget_score || 0)) * 100);
}
function sourceIcon(url = '') {
  if (!url) return '📄';
  if (url.includes('youtube') || url.includes('youtu.be')) return '▶';
  if (url.includes('.pdf') || url.includes('pdf')) return '📕';
  if (url.includes('github')) return '⌥';
  return '🔗';
}
function repStage(interval) {
  if (!interval || interval < 3) return { label: 'New',      color: '#f87171' };
  if (interval < 7)              return { label: 'Learning', color: '#fbbf24' };
  if (interval < 30)             return { label: 'Reviewing',color: '#34d399' };
  return                                { label: 'Mastered', color: '#818cf8' };
}

// ── toGraphData ───────────────────────────────────────────────────────────────
function toGraphData(nodes, edges) {
  const nodeSet = new Set(nodes.map(n => n.concept_id));
  return {
    nodes: nodes.map(n => ({
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
      val: Math.max(1.5, (n.edge_count || 1) * 0.9),
    })),
    links: (edges || [])
      .filter(e => e.source_id && e.target_id
               && nodeSet.has(e.source_id) && nodeSet.has(e.target_id))
      .map(e => ({
        source:     e.source_id,
        target:     e.target_id,
        type:       e.type || '',
        confidence: e.confidence ?? 1,
      })),
  };
}

// ── NodeCard — the animated pop-up card shown on click ───────────────────────
function NodeCard({ node, onClose, onDelete, onUpdate, onReview }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isEditing,     setIsEditing]     = useState(false);
  const [editName,      setEditName]      = useState(node.name     || '');
  const [editDomain,    setEditDomain]    = useState(node.domain   || '');
  const [editSummary,   setEditSummary]   = useState(node.summary  || '');
  const [saving,        setSaving]        = useState(false);
  const stage = repStage(node.rep_interval);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await onUpdate?.(node.concept_id, {
        name:    editName.trim(),
        domain:  editDomain.trim() || 'General',
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
    <motion.div
      className="nc-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.div
        className="nc-card"
        initial={{ opacity: 0, scale: 0.88, y: 24 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{    opacity: 0, scale: 0.92,  y: 12 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        onClick={e => e.stopPropagation()}
        style={{ '--accent': nodeColor(node) }}
      >
        {/* Accent bar */}
        <div className="nc-card__bar" style={{ background: nodeColor(node) }} />

        {/* Close */}
        <button className="nc-card__close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="nc-card__header">
          <div className="nc-card__domain" style={{ color: nodeColor(node) }}>
            {node.domain || 'General'}
          </div>
          <div className="nc-card__stage" style={{ color: stage.color }}>
            ● {stage.label}
          </div>
        </div>

        {isEditing ? (
          <div className="nc-card__edit-block">
            <label className="nc-card__edit-label">Name</label>
            <input  className="nc-card__edit-input" value={editName}    onChange={e => setEditName(e.target.value)} />
            <label className="nc-card__edit-label">Domain</label>
            <input  className="nc-card__edit-input" value={editDomain}  onChange={e => setEditDomain(e.target.value)} />
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
          <>
            <div className="nc-card__name">{node.name}</div>
            <p className="nc-card__summary">{node.summary || '—'}</p>
          </>
        )}

        {/* Retention bar */}
        <div className="nc-card__retention-row">
          <span className="nc-card__ret-label">Memory retention</span>
          <span className="nc-card__ret-pct">{retentionPct(node.forget_score)}%</span>
        </div>
        <div className="nc-card__ret-track">
          <motion.div
            className="nc-card__ret-fill"
            initial={{ width: 0 }}
            animate={{ width: `${retentionPct(node.forget_score)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.15 }}
            style={{ background: nodeColor(node) }}
          />
        </div>

        {/* Stats grid */}
        <div className="nc-card__grid">
          <div className="nc-card__cell">
            <div className="nc-card__cell-label">Studied</div>
            <div className="nc-card__cell-value">{formatDate(node.created_at)}</div>
            <div className="nc-card__cell-sub">{formatTime(node.created_at)}</div>
          </div>
          <div className="nc-card__cell">
            <div className="nc-card__cell-label">Last seen</div>
            <div className="nc-card__cell-value">{formatDate(node.last_seen)}</div>
            <div className="nc-card__cell-sub">{formatTime(node.last_seen)}</div>
          </div>
          <div className="nc-card__cell">
            <div className="nc-card__cell-label">Reviews</div>
            <div className="nc-card__cell-value">{node.rep_count ?? 0}</div>
            <div className="nc-card__cell-sub">times</div>
          </div>
          <div className="nc-card__cell">
            <div className="nc-card__cell-label">Next in</div>
            <div className="nc-card__cell-value">{node.rep_interval ?? 1}</div>
            <div className="nc-card__cell-sub">days</div>
          </div>
          <div className="nc-card__cell">
            <div className="nc-card__cell-label">Ease</div>
            <div className="nc-card__cell-value">{(node.ease_factor ?? 2.5).toFixed(1)}</div>
            <div className="nc-card__cell-sub">factor</div>
          </div>
          <div className="nc-card__cell">
            <div className="nc-card__cell-label">Forget</div>
            <div className="nc-card__cell-value">{((node.forget_score ?? 0) * 100).toFixed(1)}</div>
            <div className="nc-card__cell-sub">%</div>
          </div>
        </div>

        {/* Source */}
        {node.source_url && (
          <a
            className="nc-card__source"
            href={node.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            <span className="nc-card__source-icon">{sourceIcon(node.source_url)}</span>
            <span className="nc-card__source-url">
              {node.source_url.replace(/^https?:\/\//, '').slice(0, 55)}
              {node.source_url.length > 62 ? '…' : ''}
            </span>
            <span className="nc-card__source-arrow">↗</span>
          </a>
        )}

        {/* Action buttons */}
        <div className="nc-card__actions">
          <button className="nc-card__btn nc-card__btn--primary"
            onClick={() => onReview?.(node.concept_id)}>
            ↺ Review Now
          </button>
          {!isEditing && (
            <button className="nc-card__btn"
              onClick={() => setIsEditing(true)}>
              ✎ Edit
            </button>
          )}
          <button
            className="nc-card__btn nc-card__btn--danger"
            style={confirmDelete ? { background: '#ef4444', color: '#fff' } : {}}
            onClick={handleDelete}
          >
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
  const [input,  setInput]  = useState('');
  const bottomRef           = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (input.trim() && !loading) { send(input.trim()); setInput(''); }
  };
  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="bg-chat">
      <div className="bg-chat__header">
        <div>
          <div className="bg-chat__eyebrow">Hybrid RAG</div>
          <div className="bg-chat__title">SECOND BRAIN</div>
        </div>
        {messages.length > 0 && (
          <button className="bg-chat__clear" onClick={clear} data-cursor="hover">Clear</button>
        )}
      </div>

      <div className="bg-chat__messages">
        {messages.length === 0 && (
          <div className="bg-chat__empty">
            <div className="bg-chat__empty-title">Ask anything</div>
            <div className="bg-chat__empty-sub">
              Answers grounded in your captured knowledge with cited sources.
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`bg-chat__bubble bg-chat__bubble--${msg.role}`}>
            <p>{msg.content}</p>
            {msg.citations?.length > 0 && (
              <div className="bg-chat__citations">
                {msg.citations.map((c, j) => (
                  <button key={j} className="bg-chat__cite"
                    onClick={() => onConceptClick?.(c)} title={c.source_url}
                    data-cursor="hover">
                    ◎ {c.name}
                  </button>
                ))}
              </div>
            )}
            {msg.latency_ms && (
              <div className="bg-chat__latency">{msg.latency_ms.toFixed(0)}ms</div>
            )}
          </div>
        ))}
        {loading && <div className="bg-chat__typing">Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="bg-chat__input-row">
        <input className="bg-chat__input"
          placeholder="Ask your Second Brain…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="bg-chat__send"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          data-cursor="hover">↑</button>
      </div>
    </div>
  );
}

// ── Graph controls overlay ────────────────────────────────────────────────────
function GraphControls({ searchTerm, setSearchTerm, selectedDomains, toggleDomain, uniqueDomains, nodeCount, totalCount }) {
  return (
    <div className="bg-controls">
      <div className="bg-controls__search-wrap">
        <input className="bg-controls__search"
          placeholder="Search concepts… (Ctrl+K)"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)} />
        {searchTerm && (
          <button className="bg-controls__clear" onClick={() => setSearchTerm('')}>✕</button>
        )}
        <span className="bg-controls__count">{nodeCount}/{totalCount}</span>
      </div>
      {uniqueDomains.length > 0 && (
        <div className="bg-controls__domains">
          {uniqueDomains.map(d => (
            <button key={d}
              className={`bg-controls__domain ${selectedDomains.has(d) ? 'is-active' : ''}`}
              onClick={() => toggleDomain(d)}
              style={selectedDomains.has(d)
                ? { background: DOMAIN_COLORS[d] || '#94a3b8', borderColor: DOMAIN_COLORS[d] || '#94a3b8', color: '#fff' }
                : {}}
              data-cursor="hover">
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main BrainGraphPage ───────────────────────────────────────────────────────
export default function BrainGraphPage({ onBack }) {
  const { nodes, edges, stats, loading, error, refresh } = useGraph();

  const [selectedNode,    setSelectedNode]    = useState(null);
  const [searchTerm,      setSearchTerm]      = useState('');
  const [selectedDomains, setSelectedDomains] = useState(new Set());
  const [graphSize,       setGraphSize]       = useState({ w: 0, h: 0 });
  const [chatOpen,        setChatOpen]        = useState(true);
  const [SpriteText,      setSpriteText]      = useState(null);

  const graphWrapRef = useRef(null);
  const fgRef        = useRef(null);

  // Load SpriteText dynamically (same chunk as the 3D graph)
  useEffect(() => {
    import('three-spritetext').then(m => setSpriteText(() => m.default));
  }, []);

  // Measure container for the graph
  useEffect(() => {
    if (!graphWrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setGraphSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(graphWrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Ctrl+K
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector('.bg-controls__search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Slow auto-rotate when idle
  useEffect(() => {
    if (!fgRef.current) return;
    let angle = 0;
    const id = setInterval(() => {
      if (selectedNode) return;
      angle += 0.15;
      fgRef.current.cameraPosition(
        { x: 700 * Math.sin(angle * Math.PI / 180), z: 700 * Math.cos(angle * Math.PI / 180) },
        undefined, 0
      );
    }, 33);
    return () => clearInterval(id);
  }, [selectedNode]);

  // Filtered data
  const uniqueDomains = [...new Set(nodes.map(n => n.domain || 'General'))].sort();
  const filteredNodes = nodes.filter(n => {
    const matchSearch = !searchTerm.trim() ||
      `${n.name} ${n.domain} ${n.summary}`.toLowerCase().includes(searchTerm.toLowerCase());
    const matchDomain = selectedDomains.size === 0 || selectedDomains.has(n.domain || 'General');
    return matchSearch && matchDomain;
  });
  const filteredIds = new Set(filteredNodes.map(n => n.concept_id));

  const toggleDomain = d => setSelectedDomains(prev => {
    const next = new Set(prev);
    next.has(d) ? next.delete(d) : next.add(d);
    return next;
  });

  const graphData = toGraphData(
    filteredNodes,
    (edges || []).filter(e => filteredIds.has(e.source_id) && filteredIds.has(e.target_id))
  );

  // ── Node click: zoom camera then show card ─────────────────────────────────
  const handleNodeClick = useCallback(node => {
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
    });
    // Smooth camera zoom to clicked node
    if (fgRef.current) {
      const dist  = 120;
      const distRatio = 1 + dist / Math.hypot(node.x, node.y, node.z);
      fgRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
        { x: node.x, y: node.y, z: node.z },
        700
      );
    }
  }, []);

  // Citation click from chat
  const handleCitationClick = useCallback(citation => {
    const match = nodes.find(n =>
      n.concept_id === citation.concept_id ||
      n.name?.toLowerCase() === citation.name?.toLowerCase()
    );
    if (match) setSelectedNode(match);
  }, [nodes]);

  const handleDeleteNode = async id => {
    await graphAPI.deleteConcept(id);
    setSelectedNode(null);
    refresh();
  };
  const handleUpdateNode = async (id, data) => {
    await graphAPI.updateConcept(id, data);
    setSelectedNode(prev => prev ? { ...prev, ...data } : null);
    refresh();
  };
  const handleReviewNode = async id => {
    await memoryAPI.review(id);
    refresh();
  };

  // ── nodeThreeObject: sphere + floating name label (text-nodes style) ────────
  const nodeThreeObject = useCallback(node => {
    if (!SpriteText) return null;
    const sprite = new SpriteText(node.name);
    sprite.color    = nodeColor(node);
    sprite.textHeight  = 5;
    sprite.fontFace    = 'JetBrains Mono, monospace';
    sprite.fontWeight  = '600';
    // Position the label slightly above the sphere
    sprite.center.y    = -0.8;
    return sprite;
  }, [SpriteText]);

  return (
    <div className="bg-shell">

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <header className="bg-topbar">
        <button className="bg-topbar__back" onClick={onBack} data-cursor="hover">
          ← Dashboard
        </button>
        <div className="bg-topbar__center">
          <span className="bg-topbar__title">MY BRAIN</span>
          {stats && (
            <>
              <span className="bg-topbar__stat">{stats.node_count ?? 0} concepts</span>
              <span className="bg-topbar__stat">{stats.edge_count ?? 0} edges</span>
              <span className="bg-topbar__stat">{Object.keys(stats.domains || {}).length} domains</span>
            </>
          )}
        </div>
        <div className="bg-topbar__right">
          <button className={`bg-topbar__btn ${chatOpen ? 'is-active' : ''}`}
            onClick={() => setChatOpen(v => !v)} data-cursor="hover">
            {chatOpen ? 'Hide Chat' : 'Show Chat'}
          </button>
          <button className="bg-topbar__btn" onClick={refresh} data-cursor="hover">↻ Refresh</button>
        </div>
      </header>

      {/* ── MAIN ─────────────────────────────────────────────────────────── */}
      <div className="bg-main">

        {/* ── GRAPH AREA ─────────────────────────────────────────────────── */}
        <div className="bg-graph-wrap" ref={graphWrapRef}>

          <GraphControls
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedDomains={selectedDomains}
            toggleDomain={toggleDomain}
            uniqueDomains={uniqueDomains}
            nodeCount={filteredNodes.length}
            totalCount={nodes.length}
          />

          {loading && (
            <div className="bg-loading">
              <div className="bg-loading__ring" />
              <div className="bg-loading__text">Loading knowledge graph…</div>
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
                backgroundColor="#06060f"

                /* ── Nodes: sphere + floating text label ────────────────── */
                nodeColor={nodeColor}
                nodeVal={n => n.val}
                nodeOpacity={0.9}
                nodeResolution={14}
                nodeLabel={() => ''}          /* disable built-in tooltip */
                nodeThreeObjectExtend={true}  /* render sphere AND sprite together */
                nodeThreeObject={SpriteText ? nodeThreeObject : undefined}

                /* ── Edges ──────────────────────────────────────────────── */
                linkColor={() => 'rgba(255,255,255,0.12)'}
                linkWidth={0.5}
                linkDirectionalParticles={2}
                linkDirectionalParticleWidth={1.4}
                linkDirectionalParticleColor={l => {
                  const src = graphData.nodes.find(n => n.id === (l.source?.id ?? l.source));
                  return src ? nodeColor(src) : '#ffffff';
                }}
                linkDirectionalParticleSpeed={0.005}

                /* ── Interactions ───────────────────────────────────────── */
                onNodeClick={handleNodeClick}
                onBackgroundClick={() => setSelectedNode(null)}
                enableNavigationControls={true}
                enableNodeDrag={true}
              />
            </Suspense>
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

          {/* ── Animated node card on click ─────────────────────────────── */}
          <AnimatePresence>
            {selectedNode && (
              <NodeCard
                key={selectedNode.concept_id}
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
                onDelete={handleDeleteNode}
                onUpdate={handleUpdateNode}
                onReview={handleReviewNode}
              />
            )}
          </AnimatePresence>
        </div>

        {/* ── CHAT SIDEBAR ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              className="bg-chat-wrap"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <ChatSidebar onConceptClick={handleCitationClick} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
