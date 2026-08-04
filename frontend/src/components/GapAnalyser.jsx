import { useState } from 'react';
import { gapAPI } from '../api/client';

/**
 * GapAnalyser — paste a job description, get a skill gap analysis.
 * OBYS editorial: two-column result layout, typographic indicators.
 */
export default function GapAnalyser() {
  const [jobDesc, setJobDesc] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div>
      <div className="t-eyebrow">Skills</div>
      <div className="t-title" style={{ marginBottom: '8px' }}>KNOWLEDGE GAPS</div>
      <div className="t-body" style={{ marginBottom: '24px' }}>
        Paste a job description to see which skills you've captured and which are missing.
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
              You Know ({report.present_skills?.length || 0})
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
                  <div key={i} className="gap-result-row gap-result-row--strong" style={{ padding: '10px 12px' }}>
                    <span className="gap-prefix">●</span>
                    <span className="gap-name">{s.skill}</span>
                    <span className="gap-score">{(s.forget_score ?? 0).toFixed(2)}</span>
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
