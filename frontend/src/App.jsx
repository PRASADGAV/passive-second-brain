import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraph } from './hooks/useGraph';
import { useWebSocket } from './hooks/useWebSocket';
import { pipelineAPI, graphAPI, memoryAPI } from './api/client';
import { tabVariant } from './animations';

import Cursor from './components/Cursor';
import Carousel3D from './components/Carousel3D';
import NodeDetail from './components/NodeDetail';
import ChatPanel from './components/ChatPanel';
import DigestPanel from './components/DigestPanel';
import InputPanel from './components/InputPanel';
import GapAnalyser from './components/GapAnalyser';
import PrivacyPanel from './components/PrivacyPanel';
import WeeklyReport from './components/WeeklyReport';
import PromptPlayground from './components/PromptPlayground';
import LandingPage from './components/LandingPage';
import FloatingGraphPage from './components/FloatingGraphPage';

const isDevMode = import.meta.env.VITE_DEVELOPER_MODE === 'true';

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'digest', label: 'Digest' },
  { id: 'report', label: 'Report' },
  { id: 'input', label: 'Add' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'privacy', label: 'Privacy' },
  ...(isDevMode ? [{ id: 'playground', label: 'Dev' }] : []),
];

function useClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('psb_onboarded') === 'true');
  const { nodes, edges, stats, loading, error, refresh, addNode, addEdge } = useGraph();
  const { connected, on } = useWebSocket();
  const clock = useClock();

  const [activeTab, setActiveTab] = useState('chat');
  const [mounted, setMounted] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [workspaceEntered, setWorkspaceEntered] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDomains, setSelectedDomains] = useState(new Set());
  const [pipelineStatus, setPipelineStatus] = useState({ status: 'idle' });
  const [showFloatingGraph, setShowFloatingGraph] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const canvasRef = useRef(null);
  const searchInputRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleExportJSON = async () => {
    try {
      const res = await graphAPI.exportJSON();
      const blob = new Blob([res.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const today = new Date().toISOString().split('T')[0];
      link.setAttribute('download', `psb-graph-export-${today}.json`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
      showToast('Downloaded Graph JSON Backup');
    } catch (err) {
      console.error('JSON export failed:', err);
      showToast('Export failed');
    }
  };

  const handleExportPNG = () => {
    if (canvasRef.current) {
      canvasRef.current.exportPNG();
      showToast('Downloaded Graph PNG Image');
    }
  };

  const handleDeleteNode = async (conceptId) => {
    try {
      await graphAPI.deleteConcept(conceptId);
      setSelectedNode(null);
      refresh();
      showToast('Concept deleted');
    } catch (err) {
      console.error('Failed to delete node:', err);
      showToast('Delete failed');
    }
  };

  const handleUpdateNode = async (conceptId, updateData) => {
    try {
      await graphAPI.updateConcept(conceptId, updateData);
      setSelectedNode(prev => prev ? { ...prev, ...updateData } : null);
      refresh();
      showToast('Concept updated');
    } catch (err) {
      console.error('Failed to update node:', err);
      showToast('Update failed');
    }
  };

  const handleReviewNode = async (conceptId) => {
    try {
      await memoryAPI.review(conceptId);
      refresh();
      showToast('Memory retention updated!');
    } catch (err) {
      console.error('Failed to review node:', err);
    }
  };

  const uniqueDomains = Array.from(new Set(nodes.map(n => n.domain || 'General'))).sort();

  const toggleDomainFilter = (domain) => {
    const newSet = new Set(selectedDomains);
    if (newSet.has(domain)) newSet.delete(domain);
    else newSet.add(domain);
    setSelectedDomains(newSet);
  };

  const getFilteredNodes = () =>
    nodes.filter(node => {
      const matchesSearch =
        !searchTerm.trim() ||
        `${node.name || ''} ${node.domain || ''} ${node.summary || ''}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
      const matchesDomain =
        selectedDomains.size === 0 || selectedDomains.has(node.domain || 'General');
      return matchesSearch && matchesDomain;
    });

  const filteredNodesCount = getFilteredNodes().length;

  useEffect(() => {
    setMounted(true);
    const timer = window.setTimeout(() => setIntroComplete(true), 280);
    pipelineAPI.getStatus().then(res => setPipelineStatus(res.data)).catch(() => {});
    const interval = setInterval(() => {
      pipelineAPI.getStatus().then(res => setPipelineStatus(res.data)).catch(() => {});
    }, 30000);
    return () => { clearInterval(interval); clearTimeout(timer); };
  }, []);

  // Keyboard shortcut: Ctrl+K or '/' to focus search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    on('node_added', data => {
      if (data.node) {
        addNode(data.node);
        showToast(`Captured: ${data.node.name}`);
      }
    });
    on('edge_added', data => { if (data.edge) addEdge(data.edge); });
    on('pipeline_status', data => { setPipelineStatus(data); });
  }, [on, addNode, addEdge]);

  const handleNodeClick = useCallback(node => setSelectedNode(node), []);

  const handleCitationClick = useCallback((citation) => {
    const matched = nodes.find(n =>
      n.concept_id === citation.concept_id ||
      n.name?.toLowerCase() === citation.name?.toLowerCase()
    );
    if (matched) {
      setSelectedNode(matched);
    }
  }, [nodes]);

  const pipelineDotClass =
    pipelineStatus.status === 'running' ? 'dot dot--running'
    : pipelineStatus.status === 'failed' ? 'dot dot--failed'
    : 'dot dot--idle';

  const pipelineLabel =
    pipelineStatus.status === 'running' ? 'RUNNING'
    : pipelineStatus.status === 'failed' ? 'FAILED'
    : pipelineStatus.last_run
      ? new Date(pipelineStatus.last_run).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : 'IDLE';

  if (!onboarded) {
    return (
      <>
        <Cursor />
        <LandingPage
          onEnter={() => {
            localStorage.setItem('psb_onboarded', 'true');
            setWorkspaceEntered(true);
            setOnboarded(true);
            refresh();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Cursor />
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'fixed',
              top: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#0D0D0D',
              color: '#FAFAF8',
              padding: '8px 16px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '12px',
              border: '1px solid #333',
              zIndex: 10000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="app-shell"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: workspaceEntered || mounted ? 1 : 0, y: workspaceEntered || mounted ? 0 : 12 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ── Top navigation ── */}
        <nav className="top-nav">
          <div className="top-nav__brand">
            <span className="brand-mark" />
            <span>PSB® Second Brain</span>
          </div>

          <div className="top-nav__center">
            <div className="top-nav__pill">Live memory graph</div>
            {stats && (
              <>
                <span className="top-nav__stat">{stats.node_count ?? 0} nodes</span>
                <span className="top-nav__stat">{stats.edge_count ?? 0} edges</span>
                <span className="top-nav__stat">{Object.keys(stats.domains || {}).length} domains</span>
              </>
            )}
          </div>

          <div className="top-nav__right">
            <div className="top-nav__clock">{clock}</div>

            <div className="top-nav__indicator">
              <div className={pipelineDotClass} />
              <span>{pipelineLabel}</span>
            </div>

            <div className="top-nav__indicator">
              <div className={`dot ${connected ? 'dot--live' : 'dot--offline'}`} />
              <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
            </div>

            <button className="top-nav__refresh" onClick={refresh} title="Refresh graph" data-cursor="hover">
              ↻
            </button>
          </div>
        </nav>

        {/* ── Workspace ── */}
        <motion.main
          className="workspace"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 20 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <section className="workspace__main">
            {/* Hero card */}
            <motion.div
              className="hero-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: introComplete ? 1 : 0, y: introComplete ? 0 : 20 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="hero-card__content">
                <p className="eyebrow">AI Memory OS</p>
                <h1>Turn scattered thinking into a living intelligence layer.</h1>
                <p className="hero-card__description">
                  Capture ideas, connect concepts, and revisit them through a minimal editorial workspace built for clarity and momentum.
                </p>
              </div>

              <motion.div
                className="hero-card__metrics"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="metric-card">
                  <span className="metric-card__value">{stats?.node_count ?? 0}</span>
                  <span className="metric-card__label">Concepts</span>
                </div>
                <div className="metric-card">
                  <span className="metric-card__value">{stats?.edge_count ?? 0}</span>
                  <span className="metric-card__label">Links</span>
                </div>
                <div className="metric-card">
                  <span className="metric-card__value">{Object.keys(stats?.domains || {}).length}</span>
                  <span className="metric-card__label">Domains</span>
                </div>
                <div className="metric-card">
                  <span className="metric-card__value">{connected ? 'On' : 'Off'}</span>
                  <span className="metric-card__label">Live sync</span>
                </div>
              </motion.div>
            </motion.div>

            {/* Graph area */}
            <motion.div
              className="graph-area"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: introComplete ? 1 : 0, y: introComplete ? 0 : 24 }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="graph-controls">
                <div className="graph-controls__input-group">
                  <input
                    ref={searchInputRef}
                    className="graph-controls__search"
                    placeholder="Search concepts... (Ctrl+K)"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    id="graph-search"
                  />
                  {searchTerm && (
                    <button className="graph-controls__clear" onClick={() => setSearchTerm('')} title="Clear">✕</button>
                  )}
                  <span className="graph-controls__count">{filteredNodesCount}/{nodes.length}</span>
                </div>

                {uniqueDomains.length > 0 && (
                  <div className="graph-controls__domains">
                    {uniqueDomains.map(domain => (
                      <button
                        key={domain}
                        className={`graph-controls__domain-tag ${selectedDomains.has(domain) ? 'is-active' : ''}`}
                        onClick={() => toggleDomainFilter(domain)}
                      >
                        {domain}
                      </button>
                    ))}
                  </div>
                )}

                <button className="graph-controls__btn" onClick={handleExportJSON} title="Export JSON" data-cursor="hover">
                  ↓
                </button>
                <button className="graph-controls__btn" onClick={handleExportPNG} title="Export PNG" data-cursor="hover">
                  ◫
                </button>
                <button
                  className="graph-controls__btn"
                  onClick={() => setShowFloatingGraph(true)}
                  title="Open 3D view"
                  data-cursor="hover"
                  style={{ width: 'auto', padding: '0 12px', fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.12em' }}
                >
                  3D ↗
                </button>
              </div>

              {loading ? (
                <div className="graph-empty">
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className="skeleton skeleton--circle" style={{ width: 20 + i*6, height: 20 + i*6 }} />
                    ))}
                  </div>
                  <div className="graph-empty__text">Loading knowledge graph…</div>
                </div>
              ) : error ? (
                <div className="graph-empty">
                  <div className="graph-empty__title">Connection Error</div>
                  <div className="graph-empty__text">{error}</div>
                  <button className="obys-btn obys-btn--inline" onClick={refresh} data-cursor="hover" style={{ marginTop: 12 }}>
                    Retry
                  </button>
                </div>
              ) : (
                <Carousel3D
                  ref={canvasRef}
                  nodes={nodes}
                  edges={edges}
                  onNodeClick={handleNodeClick}
                  searchTerm={searchTerm}
                  selectedNode={selectedNode}
                  filteredNodes={getFilteredNodes()}
                />
              )}

              <AnimatePresence>
                {selectedNode && (
                  <NodeDetail
                    node={selectedNode}
                    onClose={() => setSelectedNode(null)}
                    onDelete={handleDeleteNode}
                    onUpdate={handleUpdateNode}
                    onReview={handleReviewNode}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          </section>

          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-tabs">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={`sidebar-tab ${activeTab === tab.id ? 'sidebar-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  data-cursor="hover"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <motion.div
              className="sidebar-content"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: introComplete ? 1 : 0, y: introComplete ? 0 : 16 }}
              transition={{ duration: 0.55, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  variants={tabVariant}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  style={{ height: '100%' }}
                >
                  {activeTab === 'chat' && <ChatPanel onConceptClick={handleCitationClick} />}
                  {activeTab === 'digest' && <DigestPanel />}
                  {activeTab === 'report' && <WeeklyReport />}
                  {activeTab === 'input' && <InputPanel />}
                  {activeTab === 'gaps' && <GapAnalyser />}
                  {activeTab === 'privacy' && <PrivacyPanel />}
                  {activeTab === 'playground' && <PromptPlayground />}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </aside>
        </motion.main>
      </motion.div>

      <AnimatePresence>
        {showFloatingGraph && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
          >
            <FloatingGraphPage onBack={() => setShowFloatingGraph(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
