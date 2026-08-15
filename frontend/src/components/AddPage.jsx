import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ingestAPI, pipelineAPI } from '../api/client';

const TABS = [
  { id: 'url',   label: 'URL',        icon: '🔗' },
  { id: 'text',  label: 'Text',       icon: '✎'  },
  { id: 'pdf',   label: 'PDF',        icon: '📕' },
  { id: 'voice', label: 'Voice Note', icon: '🎙️' },
];

export default function AddPage({ onBack }) {
  const [tab,       setTab]      = useState('url');
  const [url,       setUrl]      = useState('');
  const [text,      setText]     = useState('');
  const [loading,   setLoading]  = useState(false);
  const [status,    setStatus]   = useState(null);
  const [pipeline,  setPipeline] = useState({ running: false, done: false, error: null });

  const showStatus = (type, msg) => {
    setStatus({ type, msg });
    setTimeout(() => setStatus(null), 4000);
  };

  // ── Process Now (manual pipeline trigger) ────────────────────────────────
  const runPipeline = async () => {
    if (pipeline.running) return;
    setPipeline({ running: true, done: false, error: null });
    try {
      await pipelineAPI.trigger();
      // Poll status every 3s until no longer running
      const poll = setInterval(async () => {
        try {
          const r = await pipelineAPI.getStatus();
          const s = r.data?.status;
          if (s !== 'running') {
            clearInterval(poll);
            if (s === 'failed') {
              setPipeline({ running: false, done: false, error: r.data?.error || 'Pipeline failed.' });
            } else {
              setPipeline({ running: false, done: true, error: null });
              setTimeout(() => setPipeline(p => ({ ...p, done: false })), 5000);
            }
          }
        } catch { clearInterval(poll); setPipeline({ running: false, done: false, error: 'Status check failed.' }); }
      }, 3000);
    } catch (err) {
      const msg = err.response?.status === 409
        ? 'Pipeline is already running.'
        : err.response?.data?.detail || 'Could not trigger pipeline.';
      setPipeline({ running: false, done: false, error: msg });
    }
  };

  const submitUrl = async e => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    try {
      await ingestAPI.url({ url: url.trim() });
      showStatus('success', 'URL queued for processing.');
      setUrl('');
    } catch (err) {
      showStatus('error', err.response?.data?.detail || 'Failed to submit URL.');
    } finally { setLoading(false); }
  };

  const submitText = async e => {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    try {
      await ingestAPI.text({ text: text.trim() });
      showStatus('success', 'Text queued for processing.');
      setText('');
    } catch (err) {
      showStatus('error', err.response?.data?.detail || 'Failed to submit text.');
    } finally { setLoading(false); }
  };

  const submitPdf = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      await ingestAPI.pdf(file);
      showStatus('success', `${file.name} queued for processing.`);
      e.target.value = '';
    } catch (err) {
      showStatus('error', err.response?.data?.detail || 'PDF upload failed.');
    } finally { setLoading(false); }
  };

  const submitVoice = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const res = await ingestAPI.voice(file);
      showStatus(res.data?.warning ? 'error' : 'success',
        res.data?.warning || `${file.name} queued for transcription.`);
      e.target.value = '';
    } catch (err) {
      showStatus('error', err.response?.data?.detail || 'Voice upload failed.');
    } finally { setLoading(false); }
  };

  return (
    <div className="fp-shell">
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Ingest Content</div>
          <h1 className="fp-title">ADD KNOWLEDGE</h1>
        </div>
        <div />
      </motion.header>

      <motion.div className="fp-content fp-content--narrow"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>

        {/* Status toast */}
        <AnimatePresence>
          {status && (
            <motion.div className={`fp-toast fp-toast--${status.type}`}
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              {status.msg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab picker */}
        <div className="fp-tabs">
          {TABS.map(t => (
            <button key={t.id}
              className={`fp-tab ${tab === t.id ? 'fp-tab--active' : ''}`}
              onClick={() => setTab(t.id)} data-cursor="hover">
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <AnimatePresence mode="wait">
          <motion.div key={tab}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}>

            {tab === 'url' && (
              <form className="fp-form" onSubmit={submitUrl}>
                <label className="fp-label">Article or page URL</label>
                <input className="fp-input" placeholder="https://example.com/article"
                  value={url} onChange={e => setUrl(e.target.value)} autoFocus />
                <button className="fp-submit" type="submit" disabled={loading || !url.trim()} data-cursor="hover">
                  {loading ? 'Queuing…' : '⊕ Add URL'}
                </button>
              </form>
            )}

            {tab === 'text' && (
              <form className="fp-form" onSubmit={submitText}>
                <label className="fp-label">Paste notes, highlights or any text</label>
                <textarea className="fp-input fp-input--textarea" rows={8}
                  placeholder="Paste your text here…"
                  value={text} onChange={e => setText(e.target.value)} autoFocus />
                <button className="fp-submit" type="submit" disabled={loading || !text.trim()} data-cursor="hover">
                  {loading ? 'Queuing…' : '⊕ Submit Text'}
                </button>
              </form>
            )}

            {tab === 'pdf' && (
              <div className="fp-form">
                <label className="fp-label">Upload a PDF document</label>
                <label className="fp-file-drop" data-cursor="hover">
                  <span className="fp-file-drop__icon">📕</span>
                  <span className="fp-file-drop__text">{loading ? 'Uploading…' : 'Click to choose PDF'}</span>
                  <input type="file" accept=".pdf" onChange={submitPdf} disabled={loading} style={{ display: 'none' }} />
                </label>
              </div>
            )}

            {tab === 'voice' && (
              <div className="fp-form">
                <label className="fp-label">Upload a voice note</label>
                <p className="fp-hint">Requires <code>whisper-cpp</code> installed locally.</p>
                <label className="fp-file-drop" data-cursor="hover">
                  <span className="fp-file-drop__icon">🎙️</span>
                  <span className="fp-file-drop__text">{loading ? 'Uploading…' : 'Click to choose audio (.m4a / .mp3 / .wav)'}</span>
                  <input type="file" accept=".m4a,.mp3,.wav,.ogg" onChange={submitVoice} disabled={loading} style={{ display: 'none' }} />
                </label>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        {/* ── Process Now ──────────────────────────────────────────────── */}
        <motion.div className="process-now"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}>
          <div className="process-now__left">
            <div className="process-now__title">Process Now</div>
            <div className="process-now__sub">
              {pipeline.running
                ? 'Pipeline running — extracting concepts…'
                : pipeline.done
                ? '✓ Done — knowledge graph updated.'
                : pipeline.error
                ? `⚠ ${pipeline.error}`
                : 'Run the pipeline immediately to update your knowledge graph without waiting until midnight.'}
            </div>
          </div>
          <button
            className={`process-now__btn ${pipeline.running ? 'process-now__btn--running' : pipeline.done ? 'process-now__btn--done' : ''}`}
            onClick={runPipeline}
            disabled={pipeline.running}
            data-cursor="hover"
          >
            {pipeline.running
              ? <><span className="process-now__spinner" />Running…</>
              : pipeline.done
              ? '✓ Done'
              : '▶ Run Now'}
          </button>
        </motion.div>

      </motion.div>
    </div>
  );
}
