import { useState } from 'react';
import { gapAPI, memoryAPI } from '../api/client';

/**
 * GapAnalyser — Paste job descriptions to see skill gaps, plus interactive Active Recall Flashcard Quiz.
 */
export default function GapAnalyser() {
  const [jobDesc, setJobDesc] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Active recall flashcard modal state
  const [activeCard, setActiveCard] = useState(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewStatus, setReviewStatus] = useState(null);

  async function handleAnalyse(e) {
    e.preventDefault();
    if (!jobDesc.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await gapAPI.analyse(jobDesc.trim());
      setReport(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }

  const openFlashcard = (skill) => {
    setActiveCard(skill);
    setIsFlipped(false);
    setReviewStatus(null);
  };

  const handleMarkReview = async (conceptId) => {
    if (!conceptId) return;
    setReviewStatus('Saving...');
    try {
      await memoryAPI.review(conceptId);
      setReviewStatus('Retained! Memory score updated.');
      setTimeout(() => {
        setActiveCard(null);
        setReviewStatus(null);
      }, 1200);
    } catch (err) {
      setReviewStatus('Failed to update review.');
    }
  };

  return (
    <div>
      <div className="t-eyebrow">Skills & Active Recall</div>
      <div className="t-title" style={{ marginBottom: '8px' }}>KNOWLEDGE GAPS</div>
      <div className="t-body" style={{ marginBottom: '24px' }}>
        Paste a job description to discover skill gaps, or test your memory recall on captured concepts.
      </div>

      <form onSubmit={handleAnalyse}>
        <textarea
          className="obys-input"
          placeholder="Paste job description here..."
          value={jobDesc}
          onChange={e => setJobDesc(e.target.value)}
          rows={5}
          style={{ resize: 'vertical' }}
          id="gap-job-desc"
        />
        <button
          className="obys-btn"
          type="submit"
          disabled={loading || !jobDesc.trim()}
          data-cursor="hover"
          style={{ marginTop: '14px' }}
        >
          {loading ? 'Analysing…' : 'Analyse Gaps'}
        </button>
      </form>

      {error && (
        <div className="status-msg status-msg--error" style={{ marginTop: '14px' }}>
          {error}
        </div>
      )}

      {/* Flashcard Quiz Modal */}
      {activeCard && (
        <div style={{
          marginTop: '24px',
          padding: '20px',
          border: '1px solid var(--border-color, #E5E5E0)',
          background: 'var(--bg, #FAFAF8)',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>
              ⚡ Active Recall Flashcard
            </span>
            <button
              onClick={() => setActiveCard(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}
            >
              ×
            </button>
          </div>

          <div
            onClick={() => setIsFlipped(!isFlipped)}
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              border: '1px dashed var(--border-color, #CCC)',
              cursor: 'pointer',
              minHeight: '120px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              background: isFlipped ? '#0D0D0D' : '#FFF',
              color: isFlipped ? '#FAFAF8' : '#0D0D0D',
              transition: 'all 0.3s ease'
            }}
          >
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '8px' }}>
              {activeCard.skill || activeCard.name}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.85, fontStyle: isFlipped ? 'normal' : 'italic' }}>
              {isFlipped
                ? (activeCard.summary || 'Summary captured in knowledge graph.')
                : 'Tap / Click to flip & reveal summary'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button
              className="obys-btn"
              onClick={() => handleMarkReview(activeCard.concept_id)}
              style={{ flex: 1, padding: '8px' }}
              data-cursor="hover"
            >
              ✅ I Remembered (Mark Retained)
            </button>
            <button
              className="obys-btn"
              onClick={() => setIsFlipped(!isFlipped)}
              style={{ flex: 1, padding: '8px', background: 'transparent', color: '#0D0D0D', border: '1px solid #0D0D0D' }}
              data-cursor="hover"
            >
              🔄 Flip Card
            </button>
          </div>

          {reviewStatus && (
            <div style={{ marginTop: '10px', fontSize: '12px', textAlign: 'center', fontWeight: 'bold' }}>
              {reviewStatus}
            </div>
          )}
        </div>
      )}

      {report && (
        <div style={{ marginTop: '32px' }}>
          {/* Two-column header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1px',
              background: 'var(--border)',
              border: '1px solid var(--border)',
              marginBottom: '1px',
            }}
          >
            <div
              style={{
                background: 'var(--bg)',
                padding: '8px 12px',
                fontSize: '0.68rem',
                fontWeight: 500,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'var(--green)',
              }}
            >
              You Know ({report.present_skills?.length || 0}) — Tap to Test
            </div>
            <div
              style={{
                background: 'var(--bg)',
                padding: '8px 12px',
                fontSize: '0.68rem',
                fontWeight: 500,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'var(--red)',
              }}
            >
              Missing ({report.missing_skills?.length || 0})
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1px',
              background: 'var(--border)',
              border: '1px solid var(--border)',
            }}
          >
            {/* Present skills */}
            <div style={{ background: 'var(--bg)' }}>
              {report.present_skills?.length === 0 ? (
                <div className="t-body" style={{ padding: '12px' }}>
                  None captured yet.
                </div>
              ) : (
                report.present_skills?.map((s, i) => (
                  <div
                    key={i}
                    className="gap-result-row gap-result-row--strong"
                    style={{ padding: '10px 12px', cursor: 'pointer' }}
                    onClick={() => openFlashcard(s)}
                    data-cursor="hover"
                  >
                    <span className="gap-prefix">●</span>
                    <span className="gap-name" style={{ flex: 1 }}>{s.skill}</span>
                    <span className="gap-score">{(s.forget_score ?? 0).toFixed(2)}</span>
                    <span style={{ fontSize: '10px', marginLeft: '6px', opacity: 0.6 }}>🎴</span>
                  </div>
                ))
              )}
            </div>

            {/* Missing skills */}
            <div style={{ background: 'var(--bg)' }}>
              {report.missing_skills?.length === 0 ? (
                <div className="t-body" style={{ padding: '12px' }}>
                  All skills covered!
                </div>
              ) : (
                report.missing_skills?.map((skill, i) => (
                  <div key={i} className="gap-result-row gap-result-row--missing" style={{ padding: '10px 12px' }}>
                    <span className="gap-prefix">○</span>
                    <span className="gap-name">{skill}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
