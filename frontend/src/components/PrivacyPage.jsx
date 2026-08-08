import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { graphAPI } from '../api/client';

export default function PrivacyPage({ onBack }) {
  const [nodes,   setNodes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState(null);
  const [search,  setSearch]  = useState('');

  useEffect(() => {
    graphAPI.getNodes(0, 500)
      .then(r => setNodes(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const showStatus = (type, msg) => {
    setStatus({ type, msg });
    setTimeout(() => setStatus(null), 3500);
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

      <motion.div className="fp-content"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>

        {status && (
          <div className={`fp-toast fp-toast--${status.type}`} style={{ marginBottom: 16 }}>{status.msg}</div>
        )}

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
              <span>Concept</span>
              <span>Domain</span>
              <span>Node</span>
              <span>Source</span>
            </div>
            {filtered.map((n, i) => (
              <motion.div key={n.concept_id} className="fp-privacy-row"
                initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}>
                <span className="fp-privacy-row__name">{n.name}</span>
                <span className="fp-privacy-row__domain">{n.domain}</span>
                <button className="fp-privacy-row__del"
                  onClick={() => deleteNode(n.concept_id, n.name)} title="Delete this node"
                  data-cursor="hover">✕</button>
                <button className="fp-privacy-row__del fp-privacy-row__del--source"
                  onClick={() => deleteSource(n.source_url)} title="Delete all from source"
                  data-cursor="hover">⌫</button>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
