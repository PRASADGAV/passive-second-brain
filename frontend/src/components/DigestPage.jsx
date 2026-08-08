import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { digestAPI, memoryAPI } from '../api/client';

export default function DigestPage({ onBack }) {
  const [digest,  setDigest]  = useState(null);
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([digestAPI.getToday(), memoryAPI.getAlerts(0.5)]).then(([d, a]) => {
      if (d.status === 'fulfilled') setDigest(d.value.data);
      if (a.status === 'fulfilled') setAlerts(a.value.data?.alerts || []);
      setLoading(false);
    });
  }, []);

  const handleReview = async id => {
    await memoryAPI.review(id);
    setAlerts(prev => prev.filter(a => a.concept_id !== id));
  };

  return (
    <div className="fp-shell">
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Daily Learning Summary</div>
          <h1 className="fp-title">DIGEST</h1>
        </div>
        <div />
      </motion.header>

      <motion.div className="fp-content"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>

        {loading ? (
          <div className="fp-loading"><div className="fp-loading__ring" /></div>
        ) : (
          <div className="fp-digest-grid">
            {/* Today's digest */}
            <div className="fp-card fp-card--wide">
              <div className="fp-card__eyebrow">Today</div>
              <div className="fp-card__title">LEARNING SUMMARY</div>
              {digest ? (
                <>
                  <div className="fp-digest-stats">
                    {[
                      { v: digest.new_concepts_count ?? 0, l: 'New Concepts' },
                      { v: digest.new_edges_count     ?? 0, l: 'New Edges'    },
                      { v: digest.domains_covered?.length ?? 0, l: 'Domains' },
                    ].map(s => (
                      <div key={s.l} className="fp-digest-stat">
                        <div className="fp-digest-stat__value">{s.v}</div>
                        <div className="fp-digest-stat__label">{s.l}</div>
                      </div>
                    ))}
                  </div>
                  <p className="fp-card__body">{digest.summary_text || 'No summary available.'}</p>
                  {digest.domains_covered?.length > 0 && (
                    <div className="fp-tag-row">
                      {digest.domains_covered.map(d => (
                        <span key={d} className="fp-tag">{d}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="fp-card__body fp-card__body--muted">
                  Pipeline hasn't run yet today. It runs automatically at 23:00.
                </p>
              )}
            </div>

            {/* Fading concepts */}
            <div className="fp-card">
              <div className="fp-card__eyebrow" style={{ color: '#f87171' }}>
                Needs Review {alerts.length > 0 && <span className="fp-badge fp-badge--red">{alerts.length}</span>}
              </div>
              <div className="fp-card__title">FADING MEMORY</div>
              {alerts.length === 0 ? (
                <p className="fp-card__body fp-card__body--muted">All concepts well-retained ✓</p>
              ) : (
                <div className="fp-fading-list">
                  {alerts.slice(0, 12).map((a, i) => (
                    <div key={a.concept_id} className="fp-fading-row">
                      <span className="fp-fading-row__num">{String(i+1).padStart(2,'0')}</span>
                      <span className="fp-fading-row__name">{a.name}</span>
                      <div className="fp-fading-row__bar-track">
                        <div className="fp-fading-row__bar-fill"
                          style={{ width: `${Math.round((a.forget_score||0)*100)}%` }} />
                      </div>
                      <span className="fp-fading-row__score">{Math.round((a.forget_score||0)*100)}%</span>
                      <button className="fp-fading-row__btn"
                        onClick={() => handleReview(a.concept_id)} data-cursor="hover">Review</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
