import { useState, useEffect } from 'react';
import { graphAPI } from '../api/client';

/**
 * PrivacyPanel — list captured items, delete nodes or sources.
 * OBYS editorial: table rows, thin dividers, no rounded corners.
 */
export default function PrivacyPanel() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteStatus, setDeleteStatus] = useState(null);

  useEffect(() => { fetchNodes(); }, []);

  async function fetchNodes() {
    setLoading(true);
    try {
      const res = await graphAPI.getNodes(0, 200);
      setNodes(res.data || []);
    } catch (err) {
      console.error('Failed to fetch nodes:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteNode(conceptId, name) {
    if (!confirm(`Delete "${name}" and all its edges?`)) return;
    try {
      const res = await graphAPI.deleteConcept(conceptId);
      const data = res.data;
      setDeleteStatus({
        type: 'success',
        msg: `Deleted: ${data.nodes_deleted} node(s), ${data.edges_deleted} edge(s)`,
      });
      setNodes(prev => prev.filter(n => n.concept_id !== conceptId));
    } catch (err) {
      setDeleteStatus({
        type: 'error',
        msg: err.response?.data?.detail || 'Deletion failed',
      });
    }
  }

  async function handleDeleteSource(sourceUrl) {
    if (!confirm(`Delete ALL nodes from source: ${sourceUrl}?`)) return;
    try {
      const res = await graphAPI.deleteSource(sourceUrl);
      const data = res.data;
      setDeleteStatus({
        type: 'success',
        msg: `Deleted: ${data.nodes_deleted} node(s), ${data.edges_deleted} edge(s) from source`,
      });
      setNodes(prev => prev.filter(n => n.source_url !== sourceUrl));
    } catch (err) {
      setDeleteStatus({
        type: 'error',
        msg: err.response?.data?.detail || 'Source deletion failed',
      });
    }
  }

  if (loading) {
    return (
      <div>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="skeleton" style={{ height: 44, marginBottom: 4 }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="t-eyebrow">Privacy</div>
      <div className="t-title" style={{ marginBottom: '8px' }}>DATA CONTROL</div>

      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.78rem',
          color: 'var(--ink-60)',
          marginBottom: '20px',
        }}
      >
        {nodes.length} items stored
      </div>

      {deleteStatus && (
        <div className={`status-msg ${deleteStatus.type === 'success' ? 'status-msg--success' : 'status-msg--error'}`}>
          {deleteStatus.msg}
        </div>
      )}

      {nodes.length === 0 ? (
        <div className="t-body" style={{ marginTop: '40px' }}>
          Your knowledge graph is empty.
        </div>
      ) : (
        <>
          {/* Table header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr auto auto',
              gap: 10,
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              marginBottom: 0,
            }}
          >
            {['Concept', 'Domain', '', ''].map((h, i) => (
              <span
                key={i}
                style={{
                  fontSize: '0.64rem',
                  fontWeight: 500,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-30)',
                }}
              >
                {h}
              </span>
            ))}
          </div>

          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {nodes.map(node => (
              <div key={node.concept_id} className="privacy-row">
                <span className="privacy-row__name">{node.name}</span>
                <span className="privacy-row__domain">{node.domain}</span>
                <button
                  className="privacy-row__delete"
                  onClick={() => handleDeleteNode(node.concept_id, node.name)}
                  title="Delete this concept"
                  data-cursor="hover"
                >
                  ×
                </button>
                <button
                  className="privacy-row__delete privacy-row__delete--source"
                  onClick={() => handleDeleteSource(node.source_url)}
                  title="Delete all from this source"
                  data-cursor="hover"
                >
                  ⌫
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
