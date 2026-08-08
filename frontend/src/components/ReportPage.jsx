import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { digestAPI, reportAPI } from '../api/client';

export default function ReportPage({ onBack }) {
  const [history,     setHistory]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error,       setError]       = useState(null);

  useEffect(() => {
    digestAPI.getHistory(7)
      .then(r => setHistory(r.data?.digests || []))
      .catch(err => setError(err.response?.data?.detail || err.message))
      .finally(() => setLoading(false));
  }, []);

  const downloadPDF = async () => {
    setDownloading(true); setError(null);
    try {
      const res = await reportAPI.getWeeklyReport();
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `psb-weekly-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.detail || 'PDF generation failed.');
    } finally { setDownloading(false); }
  };

  return (
    <div className="fp-shell">
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">7-Day Progress</div>
          <h1 className="fp-title">WEEKLY REPORT</h1>
        </div>
        <button className="fp-action-btn" onClick={downloadPDF} disabled={downloading} data-cursor="hover">
          {downloading ? 'Generating…' : '↓ Download PDF'}
        </button>
      </motion.header>

      <motion.div className="fp-content"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>

        {error && <div className="fp-toast fp-toast--error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="fp-loading"><div className="fp-loading__ring" /></div>
        ) : history.length === 0 ? (
          <div className="fp-empty">
            <div className="fp-empty__icon">▤</div>
            <div className="fp-empty__title">No history yet</div>
            <div className="fp-empty__sub">Digests are generated after the nightly pipeline runs at 23:00.</div>
          </div>
        ) : (
          <div className="fp-report-list">
            {history.map((day, i) => (
              <motion.div key={day.date} className="fp-report-day"
                initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.35 }}>
                <div className="fp-report-day__date">
                  {new Date(day.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                </div>
                <div className="fp-report-day__stats">
                  <span>{day.new_concepts_count ?? 0} concepts</span>
                  <span>{day.new_edges_count ?? 0} edges</span>
                </div>
                <p className="fp-report-day__summary">{day.summary_text}</p>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
