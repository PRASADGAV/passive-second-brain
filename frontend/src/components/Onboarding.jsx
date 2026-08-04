import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import client from '../api/client';
import { onboardingStep } from '../animations';

/**
 * Onboarding — 4-step setup wizard.
 * OBYS editorial: giant Bebas Neue titles, 2px progress bar, mono step counter.
 */
export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  const [healthStatus, setHealthStatus] = useState(null);
  const [polling, setPolling] = useState(true);
  const [groqKey, setGroqKey] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (step !== 1) return;
    let active = true;
    const checkHealth = async () => {
      try {
        const res = await axios.get('/api/health');
        if (active) {
          setHealthStatus(res.data);
          const services = res.data.services || {};
          if (services.neo4j === 'connected' && services.chromadb === 'connected') {
            setPolling(false);
          }
        }
      } catch {
        if (active) {
          setHealthStatus({ status: 'offline', services: { neo4j: 'unavailable', chromadb: 'unavailable' } });
        }
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [step]);

  async function handleSeedGraph() {
    setSeeding(true);
    setError(null);
    try {
      const seedRes = await client.post('/graph/seed');
      setSeedResult(seedRes.data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Seeding failed');
    } finally {
      setSeeding(false);
    }
  }

  const stepContent = {
    1: { eyebrow: 'Step 01 / 04', title: 'CONNECT\nSERVICES', desc: 'Ensure your Docker environment is up and running. Spin up Neo4j, ChromaDB, and the Python backend.' },
    2: { eyebrow: 'Step 02 / 04', title: 'CONFIGURE\nGROQ API', desc: 'We use Groq (Llama 3.3 70B) for concept extraction, relationship building, and daily digests.' },
    3: { eyebrow: 'Step 03 / 04', title: 'INSTALL\nEXTENSION', desc: 'The Chrome extension runs passively to capture educational pages and YouTube videos.' },
    4: { eyebrow: 'Step 04 / 04', title: 'SEED YOUR\nGRAPH', desc: 'Initialize your dashboard with 50 sample nodes and relationships to explore immediately.' },
  };

  const current = stepContent[step];

  return (
    <div className="onboarding">
      {/* Step counter — fixed top-right */}
      <div className="onboarding__step-counter">
        {String(step).padStart(2, '0')} / {String(totalSteps).padStart(2, '0')}
      </div>

      {/* Progress bar — fixed bottom */}
      <div className="onboarding__progress-track" />
      <div className="onboarding__progress" style={{ width: `${(step / totalSteps) * 100}%` }} />

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="onboarding__content"
          variants={onboardingStep}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <div className="onboarding__eyebrow">{current.eyebrow}</div>
          <div className="onboarding__title">{current.title}</div>
          <div className="onboarding__desc">{current.desc}</div>

          {/* Step 1 — connectivity */}
          {step === 1 && (
            <>
              <div className="onboarding__code">docker-compose up --build</div>
              <div style={{ marginBottom: '32px' }}>
                <div className="onboarding__status-row">
                  <span className="onboarding__status-label">Neo4j (Bolt Graph)</span>
                  <span className={`onboarding__status-value ${healthStatus?.services?.neo4j === 'connected' ? 'onboarding__status-value--ok' : 'onboarding__status-value--waiting'}`}>
                    {healthStatus?.services?.neo4j === 'connected' ? 'CONNECTED' : 'WAITING'}
                  </span>
                </div>
                <div className="onboarding__status-row">
                  <span className="onboarding__status-label">ChromaDB (Vector Store)</span>
                  <span className={`onboarding__status-value ${healthStatus?.services?.chromadb === 'connected' ? 'onboarding__status-value--ok' : 'onboarding__status-value--waiting'}`}>
                    {healthStatus?.services?.chromadb === 'connected' ? 'CONNECTED' : 'WAITING'}
                  </span>
                </div>
              </div>
              <button
                className="obys-btn obys-btn--primary obys-btn--large"
                disabled={polling}
                onClick={() => setStep(2)}
                data-cursor="hover"
              >
                {polling ? 'Waiting for services…' : 'Continue →'}
              </button>
            </>
          )}

          {/* Step 2 — Groq API key */}
          {step === 2 && (
            <>
              <div style={{ marginBottom: '28px' }}>
                <div className="t-eyebrow" style={{ marginBottom: '8px' }}>Groq API Key</div>
                <input
                  type="password"
                  className="obys-input"
                  placeholder="gsk_..."
                  value={groqKey}
                  onChange={e => setGroqKey(e.target.value)}
                  id="onboarding-groq-key"
                />
              </div>

              {groqKey.trim() && (
                <div className="onboarding__hint">
                  <div className="onboarding__hint-title">Add to backend/.env</div>
                  <div className="onboarding__code" style={{ marginBottom: 0 }}>
                    GROQ_API_KEY={groqKey.trim()}
                  </div>
                </div>
              )}

              <div className="onboarding__btn-row">
                <button
                  className="obys-btn obys-btn--ghost obys-btn--inline"
                  onClick={() => setStep(1)}
                  data-cursor="hover"
                >
                  Back
                </button>
                <button
                  className="obys-btn obys-btn--primary obys-btn--large"
                  style={{ flex: 1 }}
                  disabled={!groqKey.trim()}
                  onClick={() => setStep(3)}
                  data-cursor="hover"
                >
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* Step 3 — Chrome extension */}
          {step === 3 && (
            <>
              <ol className="onboarding__ol">
                <li>Open Chrome → <strong>chrome://extensions/</strong></li>
                <li>Enable <strong>Developer mode</strong> (top-right toggle)</li>
                <li>Click <strong>Load unpacked</strong></li>
                <li>Select the <strong>extension/</strong> directory</li>
                <li>Pin the <strong>Passive Second Brain</strong> extension</li>
              </ol>
              <div className="onboarding__btn-row">
                <button className="obys-btn obys-btn--ghost obys-btn--inline" onClick={() => setStep(2)} data-cursor="hover">
                  Back
                </button>
                <button
                  className="obys-btn obys-btn--primary obys-btn--large"
                  style={{ flex: 1 }}
                  onClick={() => setStep(4)}
                  data-cursor="hover"
                >
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* Step 4 — Seed graph */}
          {step === 4 && (
            <>
              {error && (
                <div className="status-msg status-msg--error" style={{ marginBottom: '16px' }}>
                  {error}
                </div>
              )}

              {seedResult ? (
                <div className="onboarding__success-box" style={{ marginBottom: '24px' }}>
                  <strong>Seeding Successful</strong>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', marginTop: '8px', color: 'var(--ink-60)' }}>
                    {seedResult.nodes_inserted} nodes · {seedResult.edges_inserted} edges
                  </div>
                </div>
              ) : (
                <button
                  className="obys-btn obys-btn--primary obys-btn--large"
                  onClick={handleSeedGraph}
                  disabled={seeding}
                  data-cursor="hover"
                  style={{ marginBottom: '24px' }}
                >
                  {seeding ? 'Seeding Graph…' : 'Load 50 Sample Concepts'}
                </button>
              )}

              <div className="onboarding__btn-row">
                <button
                  className="obys-btn obys-btn--ghost obys-btn--inline"
                  onClick={() => setStep(3)}
                  disabled={seeding}
                  data-cursor="hover"
                >
                  Back
                </button>
                <button
                  className="obys-btn obys-btn--primary obys-btn--large"
                  style={{ flex: 1 }}
                  disabled={seeding || !seedResult}
                  onClick={onComplete}
                  data-cursor="hover"
                >
                  Finish Setup & Launch
                </button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
