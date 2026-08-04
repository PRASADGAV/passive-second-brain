import { useState, useEffect, useCallback, useRef } from 'react';
import { graphAPI } from '../api/client';

/**
 * useGraph — manages graph data state and D3 simulation data.
 * Fetches nodes on mount, provides refresh, and accepts live WebSocket updates.
 */
export function useGraph() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nodesRes, statsRes] = await Promise.all([
        graphAPI.getNodes(0, 1000),
        graphAPI.getStats(),
      ]);
      setNodes(nodesRes.data || []);
      setStats(statsRes.data || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  const addNode = useCallback((node) => {
    setNodes((prev) => {
      if (prev.find((n) => n.concept_id === node.concept_id)) return prev;
      return [...prev, node];
    });
  }, []);

  const addEdge = useCallback((edge) => {
    setEdges((prev) => [...prev, edge]);
  }, []);

  return { nodes, edges, stats, loading, error, refresh: fetchGraph, addNode, addEdge };
}
