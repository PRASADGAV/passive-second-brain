import { useState, useEffect } from 'react';
import { digestAPI, memoryAPI } from '../api/client';

/**
 * DigestPanel — today's learning digest + fading concept alerts.
 * OBYS editorial: Bebas Neue header, big mono numbers, numbered rows.
 */
export default function DigestPanel() {
  const [digest, setDigest] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [digestRes, alertsRes] = await Promise.allSettled([
        digestAPI.getToday(),
        memoryAPI.getAlerts(0.5),
      ]);
      if (digestRes.status === 'fulfilled') setDigest(digestRes.value.data);
      if (alertsRes.status === 'fulfilled') setAlerts(alertsRes.value.data?.alerts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(conceptId) {
    try {
      await memoryAPI.review(conceptId);
      setAlerts(prev => prev.filter(a => a.concept_id !== conceptId));
    } catch (err) {
      console.error('Review failed:', err);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 48, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 48 }} />
      </div>
    );
  }

  return (
    <div>
      <div className="t-eyebrow">Digest</div>
      <div className="t-title" style={{ marginBottom: '24px' }}>TODAY'S LEARNING</div>

      {error && <div className="status-msg status-msg--error">{error}</div>}

      {digest ? (
        <div>
          <div className="digest__stat-row">
            <div className="digest__stat">
              <div className="digest__stat-value">{digest.new_concepts_count ?? 0}</div>
              <div className="digest__stat-label">Concepts</div>
            </div>
            <div className="digest__stat">
              <div className="digest__stat-value">{digest.new_edges_count ?? 0}</div>
              <div className="digest__stat-label">Edges</div>
            </div>
            <div className="digest__stat">
              <div className="digest__stat-value">{digest.domains_covered?.length ?? 0}</div>
              <div className="digest__stat-label">Domains</div>
            </div>
          </div>

          <div className="t-body">{digest.summary_text || 'No summary available.'}</div>

          {digest.domains_covered?.length > 0 && (
            <div style={{ marginTop: '14px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {digest.domains_covered.map((d, i) => (
                <span
                  key={i}
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px',
                    border: '1px solid var(--border)',
                    padding: '3px 8px',
                    color: 'var(--ink-60)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                  }}
                >
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="t-body" style={{ marginTop: '40px' }}>
          Pipeline hasn't run yet.
        </div>
      )}

      {/* Fading concepts */}
      <div style={{ marginTop: '32px' }}>
        <div
          className="t-eyebrow"
          style={{
            borderBottom: '1px solid var(--border)',
            paddingBottom: '8px',
            marginBottom: '0',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Fading</span>
          {alerts.length > 0 && (
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--red)' }}>
              {alerts.length}
            </span>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="t-body" style={{ padding: '16px 0' }}>
            All concepts are well-retained.
          </div>
        ) : (
          alerts.slice(0, 10).map((alert, idx) => (
            <div key={alert.concept_id} className="fading-row">
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '10px',
                  color: 'var(--ink-30)',
                  minWidth: 20,
                }}
              >
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className="fading-row__name">{alert.name}</span>
              <span className="fading-row__score">{Math.round((alert.forget_score || 0) * 100)}%</span>
              <button
                className="fading-row__review"
                onClick={() => handleReview(alert.concept_id)}
                data-cursor="hover"
              >
                Review
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
