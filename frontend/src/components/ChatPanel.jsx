import { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat';

/**
 * ChatPanel — RAG-powered conversational interface.
 * Displays interactive citation badges that highlight graph concepts on click.
 */
export default function ChatPanel({ onConceptClick }) {
  const { messages, loading, send, clear } = useChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (input.trim()) {
      send(input);
      setInput('');
    }
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div className="t-eyebrow">Hybrid RAG</div>
          <div className="t-title" style={{ fontSize: '2rem' }}>SECOND BRAIN</div>
        </div>
        {messages.length > 0 && (
          <button className="chat__clear" onClick={clear} data-cursor="hover">
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="chat__messages">
        {messages.length === 0 && (
          <div className="chat__empty">
            <div className="chat__empty-title">Ask a question</div>
            <div style={{ color: 'var(--ink-60)', fontSize: '0.88rem', fontWeight: 300, marginTop: 6 }}>
              Query your knowledge graph. Answers are grounded in your captured concepts with cited sources.
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat__bubble chat__bubble--${msg.role}`}>
            <div>{msg.content}</div>

            {msg.citations && msg.citations.length > 0 && (
              <div className="chat__citations" style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.6, alignSelf: 'center' }}>
                  Citations:
                </span>
                {msg.citations.map((c, j) => (
                  <button
                    key={j}
                    className="chat__citation"
                    title={c.source_url || c.name}
                    onClick={() => onConceptClick && onConceptClick(c)}
                    style={{
                      background: 'rgba(13,13,13,0.06)',
                      border: '1px solid var(--border-color, #E5E5E0)',
                      padding: '2px 8px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono, monospace)',
                      cursor: 'pointer',
                      borderRadius: '2px',
                      transition: 'all 0.2s ease',
                    }}
                    data-cursor="hover"
                  >
                    📍 {c.name}
                  </button>
                ))}
              </div>
            )}

            {msg.latency_ms && (
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', marginTop: '6px', color: 'var(--ink-30)' }}>
                {msg.latency_ms.toFixed(0)}ms
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat__typing" style={{ fontSize: '0.86rem', fontWeight: 300 }}>
            Thinking…
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat__input-row">
        <input
          className="chat__input"
          placeholder="Ask anything..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          id="chat-input"
        />
        <button
          className="chat__send"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          data-cursor="hover"
        >
          Send
        </button>
      </div>
    </div>
  );
}
