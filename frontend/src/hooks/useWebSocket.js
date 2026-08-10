import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * useWebSocket — manages a WebSocket connection with auto-reconnect.
 * Dispatches received events to registered handlers.
 */
export function useWebSocket(url) {
  const ws = useRef(null);
  const handlers = useRef({});
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) return;

    try {
      let wsUrl = url;
      if (!wsUrl) {
        const apiBase = import.meta.env.VITE_API_BASE_URL || '';
        // If apiBase is a relative path (e.g. '/api') or empty, use the
        // current window host so Vite's WS proxy handles it correctly.
        const isAbsolute = apiBase.startsWith('http://') || apiBase.startsWith('https://');
        if (isAbsolute) {
          const wsProto = apiBase.startsWith('https') ? 'wss' : 'ws';
          const host    = apiBase.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
          wsUrl = `${wsProto}://${host}/ws`;
        } else {
          // Relative base URL or empty → connect via current host (Vite proxy handles /ws)
          const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
          wsUrl = `${wsProto}://${window.location.host}/ws`;
        }
      }
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setConnected(true);
        console.log('[WS] Connected');
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const type = data.type || data.event;
          if (type && handlers.current[type]) {
            handlers.current[type](data);
          }
        } catch (e) {
          console.warn('[WS] Failed to parse message:', e);
        }
      };

      ws.current.onclose = () => {
        setConnected(false);
        console.log('[WS] Disconnected — reconnecting in 3s');
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.current.onerror = () => {
        setConnected(false);
      };
    } catch (e) {
      console.warn('[WS] Connection error:', e);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (ws.current) ws.current.close();
    };
  }, [connect]);

  const on = useCallback((eventType, handler) => {
    handlers.current[eventType] = handler;
  }, []);

  const off = useCallback((eventType) => {
    delete handlers.current[eventType];
  }, []);

  return { connected, on, off };
}
