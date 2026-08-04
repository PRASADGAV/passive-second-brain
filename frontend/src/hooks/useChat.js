import { useState, useCallback, useRef } from 'react';
import { chatAPI } from '../api/client';

/**
 * useChat — manages chat messages state and API calls.
 * Supports multi-turn sessions via session_id.
 */
export function useChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const sessionId = useRef(null);

  const send = useCallback(async (query) => {
    if (!query.trim()) return;

    const userMsg = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setError(null);

    try {
      const res = await chatAPI.send(query, sessionId.current);
      const data = res.data;

      sessionId.current = data.session_id;

      const assistantMsg = {
        role: 'assistant',
        content: data.answer,
        citations: data.citations || [],
        latency_ms: data.latency_ms,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      const errorMsg = {
        role: 'assistant',
        content: 'Sorry, I could not get a response. Please try again.',
        citations: [],
        error: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    sessionId.current = null;
    setError(null);
  }, []);

  return { messages, loading, error, send, clear };
}
