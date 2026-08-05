import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { slideInRight } from '../animations';

/**
 * NodeDetail — slide-in inspector panel for a clicked graph node.
 * Supports inline concept editing, deletion, memory review, and related concept navigation.
 */
export default function NodeDetail({ node, onClose, relatedNodes = [], onRelatedClick, onDelete, onUpdate, onReview }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (node) {
      setEditName(node.name || '');
      setEditDomain(node.domain || '');
      setEditSummary(node.summary || '');
      setIsEditing(false);
      setConfirmDelete(false);
    }
  }, [node]);

  if (!node) return null;

  const retention = 1 - (node.forget_score ?? 0);
  const retentionPct = Math.round(retention * 100);

  const getStageColor = interval => {
    if (!interval || interval < 3) return 'var(--red)';
    if (interval < 7) return '#FF8800';
    if (interval < 30) return 'var(--green)';
    return 'var(--ink)';
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setSubmitting(true);
    try {
      if (onUpdate) {
        await onUpdate(node.concept_id, {
          name: editName.trim(),
          domain: editDomain.trim() || 'General',
          summary: editSummary.trim(),
        });
      }
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update concept:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSubmitting(true);
    try {
      if (onDelete) {
        await onDelete(node.concept_id);
      }
      onClose();
    } catch (err) {
      console.error('Failed to delete concept:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewClick = async () => {
    if (onReview) {
      await onReview(node.concept_id);
    }
  };

  return (
    <motion.div
      className="node-detail"
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      key={node.concept_id}
    >
      <button className="node-detail__close" onClick={onClose} data-cursor="hover">×</button>

      {isEditing ? (
        <div style={{ marginTop: '10px', marginBottom: '20px' }}>
          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.7 }}>Domain</label>
          <input
            type="text"
            className="input-field"
            value={editDomain}
            onChange={e => setEditDomain(e.target.value)}
            style={{ width: '100%', marginBottom: '10px', padding: '6px 10px' }}
          />
          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.7 }}>Concept Name</label>
          <input
            type="text"
            className="input-field"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            style={{ width: '100%', marginBottom: '10px', padding: '6px 10px', fontWeight: 'bold' }}
          />
        </div>
      ) : (
        <>
          <div className="node-detail__eyebrow">{node.domain}</div>
          <div className="node-detail__name">{node.name}</div>
        </>
      )}

      <hr className="divider" style={{ margin: '0 0 20px 0' }} />

      {isEditing ? (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.7 }}>Summary</label>
          <textarea
            className="input-field"
            rows={4}
            value={editSummary}
            onChange={e => setEditSummary(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', fontFamily: 'var(--font-sans)', fontSize: '13px' }}
          />
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button
              className="node-detail__action-btn node-detail__action-btn--primary"
              onClick={handleSaveEdit}
              disabled={submitting}
              style={{ flex: 1 }}
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              className="node-detail__action-btn node-detail__action-btn--secondary"
              onClick={() => setIsEditing(false)}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="node-detail__summary">{node.summary || '—'}</div>
      )}

      <hr className="divider" />

      {/* Memory retention bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span className="node-detail__retention-label">Memory Retention</span>
        <span className="node-detail__retention-score">{retentionPct}%</span>
      </div>
      <div className="node-detail__bar">
        <div className="node-detail__bar-fill" style={{ width: `${retentionPct}%` }} />
      </div>

      <hr className="divider" />

      {/* SM-2 meta grid */}
      <div className="node-detail__meta-grid">
        <div>
          <div className="node-detail__meta-label">Forget</div>
          <div className="node-detail__meta-value">{(node.forget_score ?? 0).toFixed(4)}</div>
        </div>
        <div>
          <div className="node-detail__meta-label">Ease</div>
          <div className="node-detail__meta-value">{(node.ease_factor ?? 2.5).toFixed(2)}</div>
        </div>
        <div>
          <div className="node-detail__meta-label">Reps</div>
          <div className="node-detail__meta-value">{node.rep_count ?? 0}</div>
        </div>
        <div>
          <div className="node-detail__meta-label">Interval</div>
          <div className="node-detail__meta-value">{node.rep_interval ?? 1}d</div>
        </div>
        <div>
          <div className="node-detail__meta-label">Created</div>
          <div className="node-detail__meta-value">
            {node.created_at ? new Date(node.created_at).toLocaleDateString() : '—'}
          </div>
        </div>
        <div>
          <div className="node-detail__meta-label">Last Seen</div>
          <div className="node-detail__meta-value">
            {node.last_seen ? new Date(node.last_seen).toLocaleDateString() : '—'}
          </div>
        </div>
      </div>

      {/* Source URL */}
      {node.source_url && (
        <>
          <hr className="divider" />
          <a
            href={node.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="node-detail__source"
            data-cursor="hover"
          >
            {node.source_url.length > 50 ? node.source_url.slice(0, 50) + '…' : node.source_url}
          </a>
        </>
      )}

      {/* Related concepts */}
      {relatedNodes && relatedNodes.length > 0 && (
        <>
          <hr className="divider" />
          <div>
            <div className="node-detail__section-title">Related Concepts</div>
            <div className="node-detail__related-list">
              {relatedNodes.slice(0, 5).map(relNode => (
                <button
                  key={relNode.concept_id}
                  className="node-detail__related-item"
                  onClick={() => onRelatedClick && onRelatedClick(relNode)}
                  data-cursor="hover"
                >
                  <div
                    className="node-detail__related-dot"
                    style={{ background: getStageColor(relNode.rep_interval) }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="node-detail__related-name">{relNode.name}</div>
                    <div className="node-detail__related-domain">{relNode.domain}</div>
                  </div>
                  <span className="node-detail__related-arrow">→</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Action buttons */}
      <div className="node-detail__actions" style={{ flexDirection: 'column', gap: '8px' }}>
        {!isEditing && (
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <button
              className="node-detail__action-btn node-detail__action-btn--primary"
              onClick={handleReviewClick}
              data-cursor="hover"
              style={{ flex: 1 }}
            >
              Review Now
            </button>
            <button
              className="node-detail__action-btn node-detail__action-btn--secondary"
              onClick={() => setIsEditing(true)}
              data-cursor="hover"
              style={{ flex: 1 }}
            >
              Edit Node
            </button>
          </div>
        )}

        <button
          className="node-detail__action-btn"
          onClick={handleDelete}
          disabled={submitting}
          style={{
            width: '100%',
            background: confirmDelete ? 'var(--red)' : 'transparent',
            color: confirmDelete ? '#FFF' : 'var(--red)',
            border: '1px solid var(--red)',
            transition: 'all 0.2s ease',
          }}
          data-cursor="hover"
        >
          {confirmDelete ? (submitting ? 'Deleting...' : 'Confirm Delete Concept?') : 'Delete Concept'}
        </button>
      </div>
    </motion.div>
  );
}
