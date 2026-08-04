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
      const wsUrl = url || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
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
