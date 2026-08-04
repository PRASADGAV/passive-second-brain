import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraph } from '../hooks/useGraph';
import './FloatingGraphPage.css';

// ── Domain colour palette (editorial, white-bg style) ──────────────────────────
const DOMAIN_COLORS = {
  'Machine Learning': { bg: '#FAFAF8', accent: '#0D0D0D', tag: 'rgba(13,13,13,0.4)' },
  'Web Development':  { bg: '#F5F5F3', accent: '#0D0D0D', tag: 'rgba(13,13,13,0.4)' },
  'System Design':    { bg: '#F2F2F0', accent: '#0D0D0D', tag: 'rgba(13,13,13,0.4)' },
  'DSA':              { bg: '#FAFAF8', accent: '#0D0D0D', tag: 'rgba(13,13,13,0.4)' },
  'DevOps':           { bg: '#F5F5F3', accent: '#0D0D0D', tag: 'rgba(13,13,13,0.4)' },
  'Data Science':     { bg: '#F2F2F0', accent: '#0D0D0D', tag: 'rgba(13,13,13,0.4)' },
  'General':          { bg: '#FAFAF8', accent: '#0D0D0D', tag: 'rgba(13,13,13,0.4)' },
};

function getDomainStyle(domain) {
  return DOMAIN_COLORS[domain] || DOMAIN_COLORS['General'];
}

// ── Seed random positions that look like scattered cards ───────────────
function generateCardPositions(count) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    // Spread across a large virtual canvas
    const col = i % 4;
    const row = Math.floor(i / 4);
    const jitterX = (Math.random() - 0.5) * 200;
    const jitterY = (Math.random() - 0.5) * 120;
    const rotateZ = (Math.random() - 0.5) * 18;
    const rotateX = (Math.random() - 0.5) * 12;
    const rotateY = (Math.random() - 0.5) * 14;
    const depth   = Math.random() * 200 - 100; // z-depth
    const scale   = 0.75 + Math.random() * 0.45;

    positions.push({
      x: col * 340 - 510 + jitterX,
      y: row * 280 - 200 + jitterY,
      z: depth,
      rotateZ,
      rotateX,
      rotateY,
      scale,
      driftX: (Math.random() - 0.5) * 30,
      driftY: (Math.random() - 0.5) * 20,
      driftDuration: 6 + Math.random() * 8,
      driftDelay: Math.random() * -8,
    });
  }
  return positions;
}

function ForgetBar({ score }) {
  const pct = Math.max(4, Math.round((1 - (score || 0)) * 100));
  return (
    <div className="fg-card__bar-track">
      <div className="fg-card__bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function FloatingCard({ node, position, index, onClick, isSelected }) {
  const ds = getDomainStyle(node.domain);

  return (
    <motion.div
      className={`fg-card ${isSelected ? 'fg-card--selected' : ''}`}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 280,
        background: ds.bg,
        border: `1px solid rgba(0,0,0,0.08)`,
        transformStyle: 'preserve-3d',
        cursor: 'pointer',
        zIndex: isSelected ? 100 : Math.floor(position.scale * 10),
      }}
      initial={{
        opacity: 0,
        x: position.x - 140,
        y: position.y - 180,
        scale: 0,
        rotateZ: position.rotateZ * 2,
      }}
      animate={{
        opacity: isSelected ? 1 : 0.72 + position.scale * 0.28,
        x: position.x - 140,
        y: position.y - 180,
        scale: isSelected ? 1.08 : position.scale,
        rotateZ: isSelected ? 0 : position.rotateZ,
        rotateX: isSelected ? 0 : position.rotateX,
        rotateY: isSelected ? 0 : position.rotateY,
      }}
      transition={{
        opacity: { duration: 0.6, delay: index * 0.04 },
        scale:   { duration: 0.8, delay: index * 0.04, type: 'spring', stiffness: 60, damping: 15 },
        x:       { duration: 0.8, delay: index * 0.04, type: 'spring', stiffness: 50, damping: 18 },
        y:       { duration: 0.8, delay: index * 0.04, type: 'spring', stiffness: 50, damping: 18 },
        rotateZ: { duration: 0.8, delay: index * 0.04 },
        rotateX: { duration: 0.8, delay: index * 0.04 },
        rotateY: { duration: 0.8, delay: index * 0.04 },
      }}
      whileHover={{
        scale: position.scale * 1.06,
        rotateZ: position.rotateZ * 0.3,
        opacity: 1,
        transition: { duration: 0.3 },
      }}
      onClick={() => onClick(node)}
    >
      {/* Drift animation — CSS keyframe (much lighter than framer motion infinite) */}
      <div
        className="fg-card__drift"
        style={{
          '--drift-x': `${position.driftX}px`,
          '--drift-y': `${position.driftY}px`,
          '--drift-dur': `${position.driftDuration}s`,
          '--drift-delay': `${position.driftDelay}s`,
        }}
      >
        <div className="fg-card__inner">
          <div className="fg-card__header">
            <span className="fg-card__domain" style={{ color: ds.tag }}>
              {node.domain || 'General'}
            </span>
            <span className="fg-card__dot" />
          </div>

          <div className="fg-card__name" style={{ color: ds.accent }}>
            {node.name}
          </div>

          <div className="fg-card__summary">
            {node.summary?.slice(0, 90)}{node.summary?.length > 90 ? '…' : ''}
          </div>

          <div className="fg-card__footer">
            <ForgetBar score={node.forget_score} />
            <div className="fg-card__meta">
              <span>{node.rep_count || 0} reviews</span>
              <span>{node.edge_count || 0} links</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Expanded card detail overlay ──────────────────────────────────────
function CardDetail({ node, onClose }) {
  const ds = getDomainStyle(node.domain);
  return (
    <motion.div
      className="fg-detail"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="fg-detail__card"
        style={{ background: ds.bg, border: `1px solid rgba(0,0,0,0.08)` }}
        initial={{ scale: 0.85, y: 40 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={e => e.stopPropagation()}
      >
        <button className="fg-detail__close" onClick={onClose}>×</button>

        <div className="fg-detail__domain" style={{ color: ds.tag }}>
          {node.domain || 'General'}
        </div>
        <div className="fg-detail__name" style={{ color: ds.accent }}>
          {node.name}
        </div>

        <p className="fg-detail__summary">{node.summary}</p>

        <div className="fg-detail__bar-label">Memory retention</div>
        <div className="fg-detail__bar-track">
          <div
            className="fg-detail__bar-fill"
            style={{ width: `${Math.max(4, Math.round((1 - (node.forget_score || 0)) * 100))}%` }}
          />
        </div>
        <div className="fg-detail__bar-pct">
          {Math.round((1 - (node.forget_score || 0)) * 100)}%
        </div>

        <div className="fg-detail__grid">
          <div className="fg-detail__item">
            <div className="fg-detail__item-label">Ease factor</div>
            <div className="fg-detail__item-value">{(node.ease_factor || 2.5).toFixed(2)}</div>
          </div>
          <div className="fg-detail__item">
            <div className="fg-detail__item-label">Reviews</div>
            <div className="fg-detail__item-value">{node.rep_count || 0}</div>
          </div>
          <div className="fg-detail__item">
            <div className="fg-detail__item-label">Next review</div>
            <div className="fg-detail__item-value">{node.rep_interval || 1}d</div>
          </div>
          <div className="fg-detail__item">
            <div className="fg-detail__item-label">Links</div>
            <div className="fg-detail__item-value">{node.edge_count || 0}</div>
          </div>
        </div>

        {node.source_url && (
          <a
            className="fg-detail__source"
            href={node.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {node.source_url.length > 60
              ? node.source_url.slice(0, 60) + '…'
              : node.source_url}
            <span style={{ marginLeft: 6 }}>↗</span>
          </a>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Main page component ───────────────────────────────────────────────
export default function FloatingGraphPage({ onBack }) {
  const { nodes, loading, error, refresh } = useGraph();
  const [positions, setPositions] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const stageOffset = useRef({ x: 0, y: 0 });
  const currentOffset = useRef({ x: 0, y: 0 });

  // Drag to pan
  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - currentOffset.current.x, y: e.clientY - currentOffset.current.y };
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    if (containerRef.current) containerRef.current.style.cursor = 'grab';
  }, []);

  // Lightweight ref-based parallax + drag — no spring, no re-renders
  const handleMouseMove = useCallback((e) => {
    if (!stageRef.current || !containerRef.current) return;

    if (isDragging.current) {
      const x = e.clientX - dragStart.current.x;
      const y = e.clientY - dragStart.current.y;
      currentOffset.current = { x, y };
      stageRef.current.style.transform = `translate(${x}px, ${y}px)`;
    } else {
      // Subtle parallax when not dragging
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const px = (e.clientX - rect.left - cx) * 0.015;
      const py = (e.clientY - rect.top  - cy) * 0.015;
      const ox = currentOffset.current.x + px;
      const oy = currentOffset.current.y + py;
      stageRef.current.style.transform = `translate(${ox}px, ${oy}px)`;
    }
  }, []);

  // Generate positions when nodes load
  useEffect(() => {
    if (nodes.length > 0) {
      setPositions(generateCardPositions(nodes.length));
    }
  }, [nodes.length]);

  const filteredNodes = nodes.filter(n => {
    if (!search.trim()) return true;
    const t = search.toLowerCase();
    return (
      n.name?.toLowerCase().includes(t) ||
      n.domain?.toLowerCase().includes(t) ||
      n.summary?.toLowerCase().includes(t)
    );
  });

  return (
    <div
      className="fg-page"
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: 'grab' }}
    >
      {/* ── Top bar ── */}
      <div className="fg-topbar">
        <button className="fg-topbar__back" onClick={onBack}>← Back</button>
        <div className="fg-topbar__title">
          KNOWLEDGE GRAPH
          <span className="fg-topbar__count">{nodes.length} concepts</span>
        </div>
        <input
          className="fg-topbar__search"
          placeholder="search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Ambient background glows ── */}
      <div className="fg-ambient fg-ambient--1" />
      <div className="fg-ambient fg-ambient--2" />
      <div className="fg-ambient fg-ambient--3" />

      {/* ── Card field ── */}
      {loading ? (
        <div className="fg-loading">
          <div className="fg-loading__text">LOADING KNOWLEDGE</div>
        </div>
      ) : error ? (
        <div className="fg-loading">
          <div className="fg-loading__text">CONNECTION ERROR</div>
          <button className="fg-retry" onClick={refresh}>retry</button>
        </div>
      ) : (
        <div className="fg-stage" ref={stageRef}>
          {filteredNodes.map((node, i) => (
            positions[i] ? (
              <FloatingCard
                key={node.concept_id}
                node={node}
                position={positions[i]}
                index={i}
                isSelected={selectedNode?.concept_id === node.concept_id}
                onClick={setSelectedNode}
              />
            ) : null
          ))}
        </div>
      )}

      {/* ── Footer label (Obys style) ── */}
      <div className="fg-footer">
        <span>Move mouse to explore · Click card to expand · {filteredNodes.length} visible</span>
      </div>

      {/* ── Detail overlay ── */}
      <AnimatePresence>
        {selectedNode && (
          <CardDetail
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
