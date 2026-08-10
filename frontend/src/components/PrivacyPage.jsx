import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { graphAPI } from '../api/client';

// ── helper: trigger a blob download ──────────────────────────────────────────
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const TABS = ['Data', 'Duplicates', 'Export'];

export default function PrivacyPage({ onBack }) {
  const [activeTab,    setActiveTab]    = useState('Data');
  const [nodes,        setNodes]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [status,       setStatus]       = useState(null);
  const [search,       setSearch]       = useState('');
  const [exporting,    setExporting]    = useState(null);
  // Duplicates state
  const [dupes,        setDupes]        = useState([]);
  const [dupesLoading, setDupesLoading] = useState(false);
  const [dupesLoaded,  setDupesLoaded]  = useState(false);
  const [merging,      setMerging]      = useState(null);

  useEffect(() => {
    graphAPI.getNodes(0, 500)
      .then(r => setNodes(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const showStatus = (type, msg) => {
    setStatus({ type, msg });
    setTimeout(() => setStatus(null), 3500);
  };

  const handleExportJSON = async () => {
    setExporting('json');
    try {
      const r = await graphAPI.exportJSON();
      const today = new Date().toISOString().slice(0, 10);
      downloadBlob(r.data, `engram-export-${today}.json`);
      showStatus('success', 'JSON export downloaded.');
    } catch { showStatus('error', 'JSON export failed.'); }
    finally { setExporting(null); }
  };

  const handleExportMarkdown = async () => {
    setExporting('markdown');
    try {
      const r = await graphAPI.exportMarkdown();
      const today = new Date().toISOString().slice(0, 10);
      downloadBlob(r.data, `engram-obsidian-${today}.zip`);
      showStatus('success', 'Obsidian export downloaded — unzip into your vault.');
    } catch { showStatus('error', 'Markdown export failed.'); }
    finally { setExporting(null); }
  };

  const loadDuplicates = async () => {
    setDupesLoading(true);
    try {
      const r = await graphAPI.getDuplicates(0.80);
      setDupes(r.data || []);
      setDupesLoaded(true);
    } catch { showStatus('error', 'Could not load duplicates.'); }
    finally { setDupesLoading(false); }
  };

  const handleMerge = async (keepId, mergeId, keepName) => {
    if (!confirm(`Keep "${keepName}" and delete the duplicate?`)) return;
    setMerging(mergeId);
    try {
      await graphAPI.mergeConcepts(keepId, mergeId);
      setDupes(d => d.filter(p =>
        p.concept_a.concept_id !== mergeId && p.concept_b.concept_id !== mergeId
      ));
      setNodes(n => n.filter(nd => nd.concept_id !== mergeId));
      showStatus('success', `Merged into "${keepName}" successfully.`);
    } catch (err) {
      showStatus('error', err.response?.data?.detail || 'Merge failed.');
    } finally { setMerging(null); }
  };

  const dismissPair = (aId, bId) => {
    setDupes(d => d.filter(p =>
      !(p.concept_a.concept_id === aId && p.concept_b.concept_id === bId)
    ));
  };

  const deleteNode = async (id, name) => {
    if (!confirm(`Delete "${name}" and all its edges?`)) return;
    try {
      const r = await graphAPI.deleteConcept(id);
      setNodes(p => p.filter(n => n.concept_id !== id));
      showStatus('success', `Deleted ${r.data.nodes_deleted} node(s), ${r.data.edges_deleted} edge(s).`);
    } catch (err) {
      showStatus('error', err.response?.data?.detail || 'Deletion failed.');
    }
  };

  const deleteSource = async url => {
    if (!confirm(`Delete ALL nodes from:\n${url}`)) return;
    try {
      const r = await graphAPI.deleteSource(url);
      setNodes(p => p.filter(n => n.source_url !== url));
      showStatus('success', `Deleted ${r.data.nodes_deleted} node(s) from source.`);
    } catch (err) {
      showStatus('error', err.response?.data?.detail || 'Source deletion failed.');
    }
  };

  const filtered = nodes.filter(n =>
    !search.trim() ||
    n.name?.toLowerCase().includes(search.toLowerCase()) ||
    n.domain?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fp-shell">
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Data Control</div>
          <h1 className="fp-title">PRIVACY</h1>
        </div>
        <div className="fp-privacy-count">{nodes.length} items stored</div>
      </motion.header>

      {/* Tab bar */}
      <div className="prv-tabs">
        {TABS.map(t => (
          <button key={t} className={`prv-tab ${activeTab === t ? 'prv-tab--active' : ''}`}
            onClick={() => { setActiveTab(t); if (t === 'Duplicates' && !dupesLoaded) loadDuplicates(); }}
            data-cursor="hover">{t}</button>
        ))}
      </div>

      <motion.div className="fp-content"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>

        {status && (
          <div className={`fp-toast fp-toast--${status.type}`} style={{ marginBottom: 16 }}>{status.msg}</div>
        )}

        {/* ── DATA TAB ── */}
        {activeTab === 'Data' && (
          <>
            <input className="fp-input fp-privacy-search"
              placeholder="Search by name or domain…"
              value={search} onChange={e => setSearch(e.target.value)} />

            {loading ? (
              <div className="fp-loading"><div className="fp-loading__ring" /></div>
            ) : filtered.length === 0 ? (
              <div className="fp-empty">
                <div className="fp-empty__icon">◉</div>
                <div className="fp-empty__title">No concepts found</div>
              </div>
            ) : (
              <div className="fp-privacy-table">
                <div className="fp-privacy-table__header">
                  <span>Concept</span><span>Domain</span><span>Node</span><span>Source</span>
                </div>
                {filtered.map((n, i) => (
                  <motion.div key={n.concept_id} className="fp-privacy-row"
                    initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}>
                    <span className="fp-privacy-row__name">{n.name}</span>
                    <span className="fp-privacy-row__domain">{n.domain}</span>
                    <button className="fp-privacy-row__del"
                      onClick={() => deleteNode(n.concept_id, n.name)} data-cursor="hover">✕</button>
                    <button className="fp-privacy-row__del fp-privacy-row__del--source"
                      onClick={() => deleteSource(n.source_url)} data-cursor="hover">⌫</button>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── DUPLICATES TAB ── */}
        {activeTab === 'Duplicates' && (
          <div className="dup-panel">
            <div className="dup-panel__header">
              <p className="dup-panel__desc">
                Near-duplicate concepts detected by name similarity. Choose which one to keep —
                the other will be merged into it and deleted.
              </p>
              <button className="dup-reload-btn" onClick={loadDuplicates}
                disabled={dupesLoading} data-cursor="hover">
                {dupesLoading ? 'Scanning…' : '↺ Re-scan'}
              </button>
            </div>

            {dupesLoading && <div className="fp-loading"><div className="fp-loading__ring" /></div>}

            {!dupesLoading && dupesLoaded && dupes.length === 0 && (
              <div className="fp-empty">
                <div className="fp-empty__icon" style={{ color: '#34d399' }}>✓</div>
                <div className="fp-empty__title">No Duplicates Found</div>
                <div className="fp-empty__sub">Your knowledge graph is clean.</div>
              </div>
            )}

            {!dupesLoading && dupes.map((pair, i) => (
              <motion.div key={`${pair.concept_a.concept_id}-${pair.concept_b.concept_id}`}
                className="dup-pair"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}>
                <div className="dup-pair__header">
                  <span className="dup-pair__sim">{Math.round(pair.similarity * 100)}% similar</span>
                  <span className="dup-pair__reason">{pair.reason}</span>
                </div>
                <div className="dup-pair__nodes">
                  {[pair.concept_a, pair.concept_b].map((c, ci) => (
                    <div key={c.concept_id} className="dup-node">
                      <div className="dup-node__info">
                        <span className="dup-node__name">{c.name}</span>
                        <span className="dup-node__domain">{c.domain}</span>
                        <span className="dup-node__meta">{c.rep_count} reviews</span>
                      </div>
                      <button className="dup-node__keep"
                        disabled={merging === c.concept_id}
                        onClick={() => {
                          const other = ci === 0 ? pair.concept_b : pair.concept_a;
                          handleMerge(c.concept_id, other.concept_id, c.name);
                        }}
                        data-cursor="hover">
                        {merging === c.concept_id ? '…' : 'Keep this'}
                      </button>
                    </div>
                  ))}
                </div>
                <button className="dup-pair__dismiss"
                  onClick={() => dismissPair(pair.concept_a.concept_id, pair.concept_b.concept_id)}
                  data-cursor="hover">
                  Dismiss
                </button>
              </motion.div>
            ))}
          </div>
        )}

        {/* ── EXPORT TAB ── */}
        {activeTab === 'Export' && (
          <motion.div className="prv-export-section"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="prv-export-section__label">Export Your Knowledge</div>
            <div className="prv-export-section__row">
              <button className="prv-export-btn" onClick={handleExportJSON}
                disabled={!!exporting} data-cursor="hover">
                <span className="prv-export-btn__icon">{exporting === 'json' ? '…' : '↓'}</span>
                <span className="prv-export-btn__body">
                  <span className="prv-export-btn__title">JSON Export</span>
                  <span className="prv-export-btn__sub">Full graph — nodes, edges, metadata</span>
                </span>
                <span className="prv-export-btn__fmt">.json</span>
              </button>
              <button className="prv-export-btn prv-export-btn--obsidian" onClick={handleExportMarkdown}
                disabled={!!exporting} data-cursor="hover">
                <span className="prv-export-btn__icon">{exporting === 'markdown' ? '…' : '◈'}</span>
                <span className="prv-export-btn__body">
                  <span className="prv-export-btn__title">Obsidian Export</span>
                  <span className="prv-export-btn__sub">One .md per concept with [[backlinks]]</span>
                </span>
                <span className="prv-export-btn__fmt">.zip</span>
              </button>
            </div>
          </motion.div>
        )}

      </motion.div>
    </div>
  );
}
