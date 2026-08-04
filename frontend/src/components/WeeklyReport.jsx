import { useState, useEffect } from 'react';
import { digestAPI, reportAPI } from '../api/client';

/**
 * WeeklyReport — formatted weekly summary + PDF download.
 * OBYS editorial: minimal day rows, JetBrains Mono stats.
 */
export default function WeeklyReport() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { fetchWeeklyData(); }, []);

  async function fetchWeeklyData() {
    setLoading(true);
    setError(null);
    try {
      const res = await digestAPI.getHistory(7);
      setHistory(res.data?.digests || []);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to fetch weekly history');
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadPDF() {
    setDownloading(true);
    setError(null);
    try {
      const res = await reportAPI.getWeeklyReport();
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const today = new Date().toISOString().split('T')[0];
      link.setAttribute('download', `psb-weekly-report-${today}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'PDF generation failed.');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton" style={{ height: 40, marginBottom: 16 }} />
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: 80, marginBottom: 10 }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="t-eyebrow">Summary</div>
      <div className="t-title" style={{ marginBottom: '24px' }}>WEEKLY REPORT</div>

      <button
        className="obys-btn"
        onClick={handleDownloadPDF}
        disabled={downloading}
        data-cursor="hover"
        style={{ marginBottom: '24px' }}
      >
        {downloading ? 'Generating PDF…' : 'Download PDF'}
      </button>

      {error && <div className="status-msg status-msg--error">{error}</div>}

      {history.length === 0 ? (
        <div style={{ marginTop: '24px' }}>
          <div className="t-body" style={{ marginBottom: '12px', color: 'var(--ink-60)' }}>
            No digest history yet. Digests are generated automatically after the nightly pipeline runs.
          </div>
          <div style={{ fontSize: '11px', color: 'var(--ink-30)', lineHeight: 1.7, borderTop: '1px solid var(--ink-10)', paddingTop: '12px' }}>
            <strong style={{ fontFamily: 'JetBrains Mono', fontSize: '10px', color: 'var(--ink-60)' }}>To generate your first digest:</strong><br />
            1. Add a URL via the <em>Add</em> panel<br />
            2. Trigger the pipeline: click the status indicator in the top nav → <em>Run Now</em><br />
            3. Or wait — it runs automatically every night at 23:00
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {history.map(day => (
            <div key={day.date} className="report-day">
              <div className="report-day__header">
                <span className="report-day__date">
                  {new Date(day.date).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <div className="report-day__stats">
                  <span>{day.new_concepts_count ?? 0} concepts</span>
                  <span>{day.new_edges_count ?? 0} edges</span>
                </div>
              </div>
              <div className="report-day__summary">{day.summary_text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
