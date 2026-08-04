import { useState, useEffect } from 'react';
import { playgroundAPI } from '../api/client';

/**
 * PromptPlayground — Developer utility to test and modify system prompts dynamically.
 * Obys editorial style: JetBrains Mono textareas, minimal output box.
 */
export default function PromptPlayground() {
  const [prompts, setPrompts] = useState({ extract: '', digest: '', gaps: '' });
  const [selectedType, setSelectedType] = useState('extract');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [sampleText, setSampleText] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => { loadPrompts(); }, []);
  useEffect(() => { setCurrentPrompt(prompts[selectedType] || ''); }, [selectedType, prompts]);

  async function loadPrompts() {
    try {
      const res = await playgroundAPI.getPrompts();
      setPrompts(res.data || { extract: '', digest: '', gaps: '' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.response?.data?.detail || 'Failed to load prompts' });
    }
  }

  async function handleSave() {
    setSaving(true); setStatus(null);
    try {
      await playgroundAPI.savePrompt(selectedType, currentPrompt);
      setPrompts((prev) => ({ ...prev, [selectedType]: currentPrompt }));
      setStatus({ type: 'success', msg: 'Prompt saved. Next pipeline run will use this prompt.' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.response?.data?.detail || 'Failed to save prompt' });
    } finally { setSaving(false); }
  }

  async function handleTest() {
    if (!currentPrompt.trim() || !sampleText.trim()) return;
    setTesting(true); setTestResult(null); setStatus(null);
    try {
      const res = await playgroundAPI.testPrompt(currentPrompt, sampleText);
      setTestResult(res.data);
    } catch (err) {
      setStatus({ type: 'error', msg: err.response?.data?.detail || 'Test execution failed.' });
    } finally { setTesting(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="playground__notice">DEV MODE</div>
      <div className="t-title">PLAYGROUND</div>

      {status && (
        <div className={`status-msg ${status.type === 'success' ? 'status-msg--success' : 'status-msg--error'}`}>
          {status.msg}
        </div>
      )}

      {/* Selector */}
      <div>
        <div className="t-eyebrow" style={{ marginBottom: '8px' }}>Prompt Template</div>
        <select
          className="obys-input"
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          id="playground-type-select"
        >
          <option value="extract">Concept & Relation Extraction (extract.py)</option>
          <option value="digest">Daily Summary Generation (digest.py)</option>
          <option value="gaps">Job Skill Gap Analyzer (gaps.py)</option>
        </select>
      </div>

      {/* Editor */}
      <div>
        <div className="t-eyebrow" style={{ marginBottom: '8px' }}>System Prompt</div>
        <textarea
          className="obys-input"
          value={currentPrompt}
          onChange={(e) => setCurrentPrompt(e.target.value)}
          rows={10}
          style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '12px', lineHeight: 1.5 }}
          id="playground-prompt-editor"
        />
        <button
          className="obys-btn"
          style={{ marginTop: '12px' }}
          onClick={handleSave}
          disabled={saving}
          data-cursor="hover"
        >
          {saving ? 'Saving…' : 'Save & Apply Changes'}
        </button>
      </div>

      <hr className="divider" />

      {/* Testing */}
      <div>
        <div className="t-eyebrow" style={{ marginBottom: '8px' }}>Test Input</div>
        <textarea
          className="obys-input"
          placeholder="Paste sample text to test this prompt..."
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          rows={4}
          id="playground-sample-input"
        />
        <button
          className="obys-btn obys-btn--primary"
          style={{ marginTop: '12px' }}
          onClick={handleTest}
          disabled={testing || !sampleText.trim()}
          data-cursor="hover"
        >
          {testing ? 'Executing…' : 'Run Inference Test'}
        </button>
      </div>

      {/* Results */}
      {testResult && (
        <div>
          <div className="playground__meta">
            <span>Latency: {testResult.latency_ms}ms</span>
            <span>Tokens: {testResult.token_usage?.total_tokens}</span>
          </div>
          <pre className="playground__output">
            {testResult.raw_response}
          </pre>
        </div>
      )}
    </div>
  );
}
