import { motion, AnimatePresence } from 'framer-motion';
import { slideInRight } from '../animations';

/**
 * NodeDetail — slide-in panel for a clicked graph node.
 * OBYS editorial: Bebas Neue 52px name, 2px retention bar, mono meta grid.
 */
export default function NodeDetail({ node, onClose, relatedNodes = [], onRelatedClick }) {
  if (!node) return null;

  const retention = 1 - (node.forget_score ?? 0);
  const retentionPct = Math.round(retention * 100);

  const getStageColor = interval => {
    if (!interval || interval < 3) return 'var(--red)';
    if (interval < 7) return '#FF8800';
    if (interval < 30) return 'var(--green)';
    return 'var(--ink)';
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

      <div className="node-detail__eyebrow">{node.domain}</div>
      <div className="node-detail__name">{node.name}</div>

      <hr className="divider" style={{ margin: '0 0 20px 0' }} />

      <div className="node-detail__summary">{node.summary || '—'}</div>

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
      <div className="node-detail__actions">
        <button className="node-detail__action-btn node-detail__action-btn--primary" data-cursor="hover">
          Review Now
        </button>
        <button className="node-detail__action-btn node-detail__action-btn--secondary" data-cursor="hover">
          Schedule Review
        </button>
      </div>
    </motion.div>
  );
}
