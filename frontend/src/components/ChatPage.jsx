import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useChat } from '../hooks/useChat';

export default function ChatPage({ onBack }) {
  const { messages, loading, send, clear } = useChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (input.trim() && !loading) { send(input.trim()); setInput(''); }
  };
  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="fp-shell">
      {/* Header */}
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Hybrid RAG · Second Brain</div>
          <h1 className="fp-title">CHAT</h1>
        </div>
        {messages.length > 0 && (
          <button className="fp-action-btn" onClick={clear} data-cursor="hover">Clear history</button>
        )}
      </motion.header>

      {/* Messages */}
      <motion.div className="fp-chat-messages"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>

        {messages.length === 0 && (
          <div className="fp-chat-empty">
            <div className="fp-chat-empty__icon">◎</div>
            <div className="fp-chat-empty__title">Ask your Second Brain</div>
            <div className="fp-chat-empty__sub">
              Every answer is grounded in your captured knowledge graph — with cited sources.
            </div>
            <div className="fp-chat-suggestions">
              {['What is RAG?', 'Explain SM-2 algorithm', 'What did I learn about Docker?'].map(q => (
                <button key={q} className="fp-chat-suggestion"
                  onClick={() => { send(q); }} data-cursor="hover">{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <motion.div key={i}
            className={`fp-chat-bubble fp-chat-bubble--${msg.role}`}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}>
            <p>{msg.content}</p>
            {msg.citations?.length > 0 && (
              <div className="fp-chat-citations">
                <span className="fp-chat-citations__label">Sources:</span>
                {msg.citations.map((c, j) => (
                  <span key={j} className="fp-chat-cite" title={c.source_url}>◎ {c.name}</span>
                ))}
              </div>
            )}
            {msg.latency_ms && (
              <div className="fp-chat-latency">{msg.latency_ms.toFixed(0)}ms</div>
            )}
          </motion.div>
        ))}

        {loading && (
          <div className="fp-chat-thinking">
            <span className="fp-chat-thinking__dot" />
            <span className="fp-chat-thinking__dot" />
            <span className="fp-chat-thinking__dot" />
          </div>
        )}
        <div ref={bottomRef} />
      </motion.div>

      {/* Input */}
      <motion.div className="fp-chat-inputbar"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }}>
        <input className="fp-chat-input"
          placeholder="Ask anything about your captured knowledge…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          autoFocus
        />
        <button className="fp-chat-send"
          onClick={handleSend} disabled={loading || !input.trim()} data-cursor="hover">
          ↑ Send
        </button>
      </motion.div>
    </div>
  );
}
