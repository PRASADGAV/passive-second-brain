import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gapAPI, memoryAPI } from '../api/client';

export default function GapsPage({ onBack }) {
  const [jobDesc, setJobDesc] = useState('');
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [card,    setCard]    = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [reviewMsg, setReviewMsg] = useState(null);

  const analyse = async e => {
    e.preventDefault();
    if (!jobDesc.trim()) return;
    setLoading(true); setError(null); setReport(null);
    try {
      const res = await gapAPI.analyse(jobDesc.trim());
      setReport(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Analysis failed.');
    } finally { setLoading(false); }
  };

  const markReview = async id => {
    if (!id) return;
    try {
      await memoryAPI.review(id);
      setReviewMsg('Memory updated ✓');
      setTimeout(() => { setCard(null); setReviewMsg(null); }, 1200);
    } catch { setReviewMsg('Failed.'); }
  };

  return (
    <div className="fp-shell">
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Skills & Active Recall</div>
          <h1 className="fp-title">GAP ANALYSIS</h1>
        </div>
        <div />
      </motion.header>

      <motion.div className="fp-content fp-content--narrow"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>

        <form className="fp-form" onSubmit={analyse}>
          <label className="fp-label">Paste a job description</label>
          <textarea className="fp-input fp-input--textarea" rows={6}
            placeholder="We are looking for a Python developer with FastAPI, React, Docker…"
            value={jobDesc} onChange={e => setJobDesc(e.target.value)} />
          <button className="fp-submit" type="submit" disabled={loading || !jobDesc.trim()} data-cursor="hover">
            {loading ? 'Analysing…' : '◇ Analyse Gaps'}
          </button>
        </form>

        {error && <div className="fp-toast fp-toast--error">{error}</div>}

        {/* Flashcard overlay */}
        <AnimatePresence>
          {card && (
            <motion.div className="fp-flashcard-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setCard(null)}>
              <motion.div className="fp-flashcard"
                initial={{ scale: 0.88, y: 20 }} animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 10 }}
                onClick={e => e.stopPropagation()}>
                <div className="fp-flashcard__label">⚡ Active Recall</div>
                <div className={`fp-flashcard__face ${flipped ? 'fp-flashcard__face--flipped' : ''}`}
                  onClick={() => setFlipped(v => !v)}>
                  <div className="fp-flashcard__front">
                    <div className="fp-flashcard__skill">{card.skill || card.name}</div>
                    <div className="fp-flashcard__hint">Tap to reveal summary</div>
                  </div>
                  <div className="fp-flashcard__back">
                    <div className="fp-flashcard__summary">{card.summary || 'Captured in your knowledge graph.'}</div>
                  </div>
                </div>
                {reviewMsg && <div className="fp-flashcard__msg">{reviewMsg}</div>}
                <div className="fp-flashcard__actions">
                  <button className="fp-submit" style={{ flex: 1 }}
                    onClick={() => markReview(card.concept_id)} data-cursor="hover">✓ I Remembered</button>
                  <button className="fp-submit fp-submit--ghost" style={{ flex: 1 }}
                    onClick={() => setFlipped(v => !v)} data-cursor="hover">↺ Flip</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <AnimatePresence>
          {report && (
            <motion.div className="fp-gaps-results"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <div className="fp-gaps-col-header">
                <div className="fp-gaps-col-header__item" style={{ color: '#34d399' }}>
                  You Know ({report.present_skills?.length || 0}) — tap to test
                </div>
                <div className="fp-gaps-col-header__item" style={{ color: '#f87171' }}>
                  Missing ({report.missing_skills?.length || 0})
                </div>
              </div>
              <div className="fp-gaps-columns">
                <div className="fp-gaps-col">
                  {(report.present_skills || []).map((s, i) => (
                    <button key={i} className="fp-gaps-skill fp-gaps-skill--present"
                      onClick={() => { setCard(s); setFlipped(false); }} data-cursor="hover">
                      <span className="fp-gaps-skill__dot" style={{ background: '#34d399' }} />
                      <span className="fp-gaps-skill__name">{s.skill}</span>
                      <span className="fp-gaps-skill__score">{(s.forget_score ?? 0).toFixed(2)}</span>
                      <span className="fp-gaps-skill__flash">🎴</span>
                    </button>
                  ))}
                </div>
                <div className="fp-gaps-col">
                  {(report.missing_skills || []).map((skill, i) => (
                    <div key={i} className="fp-gaps-skill fp-gaps-skill--missing">
                      <span className="fp-gaps-skill__dot" style={{ background: '#f87171' }} />
                      <span className="fp-gaps-skill__name">{skill}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
