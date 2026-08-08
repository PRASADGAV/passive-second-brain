import { useState } from 'react';
import { ingestAPI } from '../api/client';

/**
 * InputPanel — manual content ingestion via URL, text, or PDF upload.
 * OBYS editorial: bottom-border inputs, thin dividers, flat buttons.
 */
export default function InputPanel() {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleUrlSubmit(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      await ingestAPI.url({ url: url.trim() });
      setStatus({ type: 'success', msg: 'URL queued for processing.' });
      setUrl('');
    } catch (err) {
      setStatus({ type: 'error', msg: err.response?.data?.detail || 'Failed to submit URL' });
    } finally {
      setLoading(false);
    }
  }

  async function handleTextSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      await ingestAPI.text({ text: text.trim() });
      setStatus({ type: 'success', msg: 'Text queued for processing.' });
      setText('');
    } catch (err) {
      setStatus({ type: 'error', msg: err.response?.data?.detail || 'Failed to submit text' });
    } finally {
      setLoading(false);
    }
  }

  async function handlePdfUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setStatus(null);
    try {
      await ingestAPI.pdf(file);
      setStatus({ type: 'success', msg: `${file.name} queued for processing.` });
      e.target.value = '';
    } catch (err) {
      setStatus({ type: 'error', msg: err.response?.data?.detail || 'Failed to upload PDF' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="t-eyebrow">Ingest</div>
      <div className="t-title" style={{ marginBottom: '28px' }}>ADD KNOWLEDGE</div>

      {status && (
        <div className={`status-msg ${status.type === 'success' ? 'status-msg--success' : 'status-msg--error'}`}>
          {status.msg}
        </div>
      )}

      {/* URL */}
      <form onSubmit={handleUrlSubmit}>
        <div className="t-eyebrow" style={{ marginBottom: '8px' }}>URL</div>
        <input
          className="obys-input"
          placeholder="https://example.com/article"
          value={url}
          onChange={e => setUrl(e.target.value)}
          id="ingest-url-input"
        />
        <button
          className="obys-btn"
          type="submit"
          disabled={loading || !url.trim()}
          data-cursor="hover"
          style={{ marginTop: '14px' }}
        >
          Add URL
        </button>
      </form>

      <hr className="divider" />

      {/* Text */}
      <form onSubmit={handleTextSubmit}>
        <div className="t-eyebrow" style={{ marginBottom: '8px' }}>Text</div>
        <textarea
          className="obys-input"
          placeholder="Paste notes, highlights, or any text content..."
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          style={{ resize: 'vertical' }}
          id="ingest-text-input"
        />
        <button
          className="obys-btn"
          type="submit"
          disabled={loading || !text.trim()}
          data-cursor="hover"
          style={{ marginTop: '14px' }}
        >
          Submit Text
        </button>
      </form>

      <hr className="divider" />

      {/* PDF */}
      <div>
        <div className="t-eyebrow" style={{ marginBottom: '8px' }}>PDF</div>
        <label
          style={{
            display: 'block',
            width: '100%',
            padding: '10px 0',
            borderBottom: '1px solid var(--ink-10)',
            color: 'var(--ink-60)',
            fontSize: '0.88rem',
            fontWeight: 300,
            cursor: 'none',
          }}
        >
          {loading ? 'Uploading…' : 'Choose a PDF file…'}
          <input
            type="file"
            accept=".pdf"
            onChange={handlePdfUpload}
            style={{ display: 'none' }}
            id="ingest-pdf-input"
            disabled={loading}
          />
        </label>
      </div>

      <hr className="divider" />

      {/* Voice — requires whisper-cpp installed locally */}
      <div>
        <div className="t-eyebrow" style={{ marginBottom: '4px' }}>Voice Note</div>
        <p style={{ fontSize: '11px', color: 'var(--ink-30)', marginBottom: '10px', lineHeight: 1.6 }}>
          Requires <code style={{ fontFamily: 'JetBrains Mono', fontSize: '10px' }}>whisper-cpp</code> installed locally.
          Install from <a href="https://github.com/ggerganov/whisper.cpp" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-60)' }}>github.com/ggerganov/whisper.cpp</a>
        </p>
        <label
          style={{
            display: 'block', width: '100%', padding: '10px 0',
            borderBottom: '1px solid var(--ink-10)',
            color: 'var(--ink-60)', fontSize: '0.88rem', fontWeight: 300, cursor: 'none',
          }}
        >
          {loading ? 'Uploading…' : 'Choose audio file (.m4a / .mp3 / .wav)…'}
          <input
            type="file"
            accept=".m4a,.mp3,.wav,.ogg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setLoading(true);
              setStatus(null);
              try {
                const res = await ingestAPI.voice(file);
                const warning = res.data?.warning;
                if (warning) {
                  setStatus({ type: 'error', msg: warning });
                } else {
                  setStatus({ type: 'success', msg: `${file.name} queued for transcription.` });
                }
                e.target.value = '';
              } catch (err) {
                setStatus({ type: 'error', msg: err.response?.data?.detail || 'Voice upload failed. Is whisper-cpp installed?' });
              } finally {
                setLoading(false);
              }
            }}
            style={{ display: 'none' }}
            disabled={loading}
          />
        </label>
      </div>
    </div>
  );
}
