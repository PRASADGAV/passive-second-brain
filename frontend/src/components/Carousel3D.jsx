import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import html2canvas from 'html2canvas';

const CAROUSEL_RADIUS = 520;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 400;
const PERSPECTIVE = 1600;

function getDomainColor(domain = 'General') {
  // OBYS editorial — desaturated greyscale palette, no bright colours
  const palette = {
    'Web Development': '#444444',
    'Machine Learning': '#0D0D0D',
    'System Design': '#555555',
    'DevOps': '#333333',
    'Database': '#666666',
    'API Design': '#444444',
    'Frontend': '#555555',
    'Backend': '#333333',
    'Cloud': '#777777',
    'General': '#888888',
  };
  return palette[domain] || '#666666';
}

function getSourceIcon(url = '') {
  if (!url) return '📄';
  if (url.includes('youtube') || url.includes('youtu.be')) return '▶️';
  if (url.includes('pdf')) return '📕';
  if (url.endsWith('.mp3') || url.includes('audio')) return '🎙️';
  return '🔗';
}

function formatDate(dateStr) {
  if (!dateStr) return 'Recently';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}m ago`;
}

function getRepStage(repInterval) {
  if (!repInterval || repInterval < 3) return '🔴 New';
  if (repInterval < 7) return '🟡 Learning';
  if (repInterval < 30) return '🟢 Reviewing';
  return '💎 Mastered';
}

const Carousel3D = forwardRef(({ nodes = [], edges = [], onNodeClick, searchTerm = '', filteredNodes = null }, ref) => {
  const containerRef = useRef(null);
  const [rotation, setRotation] = useState(0);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const velocityRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastDeltaRef = useRef(0);

  // Use provided filteredNodes or filter by search term
  const displayNodes = useMemo(() => {
    if (filteredNodes && Array.isArray(filteredNodes)) return filteredNodes;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return nodes;
    return nodes.filter((node) => {
      const haystack = `${node.name || ''} ${node.domain || ''} ${node.summary || ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [nodes, searchTerm, filteredNodes]);

  const angleStep = displayNodes.length > 1 ? 360 / displayNodes.length : 360;
  // Smart visibility: show all if ≤40 nodes; for larger sets, show nearest 40 to current rotation
  const MAX_VISIBLE = 40;
  const visibleNodes = useMemo(() => {
    if (displayNodes.length <= MAX_VISIBLE) return displayNodes;
    // For large graphs: show 40 nodes closest to current viewing angle
    const currentAngleIndex = Math.round((-rotation / 360) * displayNodes.length) % displayNodes.length;
    const start = ((currentAngleIndex - 20) + displayNodes.length) % displayNodes.length;
    const result = [];
    for (let i = 0; i < MAX_VISIBLE; i++) {
      result.push(displayNodes[(start + i) % displayNodes.length]);
    }
    return result;
  }, [displayNodes, rotation]);

  useImperativeHandle(ref, () => ({
    async exportPNG() {
      if (!containerRef.current) return;
      const canvas = await html2canvas(containerRef.current, {
        backgroundColor: '#FAFAF8',
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `psb-carousel-${new Date().toISOString().split('T')[0]}.png`;
      link.click();
    },
  }));

  const handleMouseDown = (e) => {
    setDragStart({ x: e.clientX, rotation });
    velocityRef.current = 0;
    lastTimeRef.current = Date.now();
  };

  const handleMouseMove = (e) => {
    if (!dragStart) return;
    const deltaX = e.clientX - dragStart.x;
    const now = Date.now();
    const deltaTime = Math.max(1, now - lastTimeRef.current);
    
    lastTimeRef.current = now;
    lastDeltaRef.current = deltaX * 0.5;
    velocityRef.current = lastDeltaRef.current / (deltaTime / 16.67); // normalized to 60fps
    
    const newRotation = dragStart.rotation - lastDeltaRef.current;
    setRotation(newRotation);
  };

  const handleMouseUp = () => {
    if (!dragStart) return;
    const finalRotation = rotation + velocityRef.current * 2;
    const snapped = Math.round(finalRotation / angleStep) * angleStep;
    setRotation(snapped);
    setDragStart(null);
    velocityRef.current = 0;
  };

  const handleCardClick = (node) => {
    setActiveNodeId(node.concept_id);
    onNodeClick?.(node);
  };

  return (
    <div
      className="carousel-3d"
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: dragStart ? 'grabbing' : 'grab' }}
    >
      <div className="carousel-3d__ambient carousel-3d__ambient--one" />
      <div className="carousel-3d__ambient carousel-3d__ambient--two" />

      <div className="carousel-3d__hud">
        <span className="carousel-3d__pill">3D KNOWLEDGE CYLINDER</span>
        <span className="carousel-3d__pill">{displayNodes.length} visible nodes</span>
      </div>

      <div className="carousel-3d__viewport" style={{ perspective: `${PERSPECTIVE}px` }}>
        <div className="carousel-3d__center" />
        <motion.div
          className="carousel-3d__cylinder"
          animate={{ rotateY: rotation }}
          transition={{ type: 'spring', stiffness: 80, damping: 20 }}
          style={{ transformStyle: 'preserve-3d' }}
        >
          <AnimatePresence>
            {visibleNodes.map((node, index) => {
              const angle = index * angleStep;
              const verticalOffset = Math.sin((angle * Math.PI) / 180) * 20;
              const hue = getDomainColor(node.domain || 'General');
              const isActive = activeNodeId === node.concept_id;

              return (
                <motion.button
                  key={node.concept_id}
                  type="button"
                  className={`carousel-3d__card ${isActive ? 'is-active' : ''}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileHover={{ scale: 1.05 }}
                  onClick={() => handleCardClick(node)}
                  style={{
                    position: 'absolute',
                    width: `${CARD_WIDTH}px`,
                    height: `${CARD_HEIGHT}px`,
                    left: '0',
                    top: '0',
                    transform: `rotateY(${angle}deg) translateZ(${CAROUSEL_RADIUS}px)`,
                    transformStyle: 'preserve-3d',
                    backfaceVisibility: 'hidden',
                  }}
                >
                  <div className="carousel-3d__card-top">
                    <span className="carousel-3d__tag">
                      {node.domain || 'General'}
                    </span>
                    <span className="carousel-3d__dot" />
                  </div>

                  <div className="carousel-3d__card-body">
                    <h3>{node.name || 'Untitled concept'}</h3>
                    <p>{node.summary || 'Captured knowledge node ready for review.'}</p>
                  </div>

                  <div className="carousel-3d__card-footer">
                    <div className="carousel-3d__bar">
                      <div
                        className="carousel-3d__bar-fill"
                        style={{ width: `${Math.max(8, (1 - (node.forget_score || 0)) * 100)}%` }}
                      />
                    </div>
                    
                    <div className="carousel-3d__stats-row">
                      <span className="carousel-3d__stat-item">
                        {getSourceIcon(node.source_url)} {node.source_url ? 'Source' : 'Local'}
                      </span>
                      <span className="carousel-3d__stat-item">
                        {getRepStage(node.rep_interval)}
                      </span>
                    </div>
                    
                    <div className="carousel-3d__meta">
                      <span title={node.last_seen}>{formatDate(node.last_seen)}</span>
                      <span>{node.edge_count || 0} links</span>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>

      <div className="carousel-3d__legend">
        <div className="carousel-3d__legend-item">
          <span className="carousel-3d__legend-dot carousel-3d__legend-dot--cyan" />
          <span>Fresh memory</span>
        </div>
        <div className="carousel-3d__legend-item">
          <span className="carousel-3d__legend-dot carousel-3d__legend-dot--purple" />
          <span>Needs review</span>
        </div>
      </div>

      {!displayNodes.length && (
        <div className="carousel-3d__empty">
          <span>No concepts match your current filter.</span>
        </div>
      )}
    </div>
  );
});

Carousel3D.displayName = 'Carousel3D';

export default Carousel3D;
