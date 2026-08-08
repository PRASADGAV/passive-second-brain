import { useState, useEffect, useCallback, useRef } from 'react';
import { graphAPI } from '../api/client';

/**
 * useGraph — manages graph data state and D3 simulation data.
 * Fetches nodes AND edges on mount, provides refresh, and accepts live WebSocket updates.
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

      // Fetch edges from stats — graph/stats returns edge_count and domain breakdown.
      // For actual edge list (source/target pairs) we use the neighbourhood data
      // embedded in stats.edges if available, otherwise keep existing WS-accumulated edges.
      // The canonical edge source is the export endpoint; for visualisation we
      // populate edges lazily from WebSocket events and on explicit refresh.
      const statsData = statsRes.data || {};
      if (Array.isArray(statsData.edges)) {
        setEdges(statsData.edges);
      }
      // If stats doesn't include edges array, edges remain accumulated from WS events
      // (no reset so live-added edges aren't lost on refresh)
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
    setEdges((prev) => {
      // Deduplicate by source_id + target_id
      const exists = prev.some(
        (e) => e.source_id === edge.source_id && e.target_id === edge.target_id
      );
      return exists ? prev : [...prev, edge];
    });
  }, []);

  return { nodes, edges, stats, loading, error, refresh: fetchGraph, addNode, addEdge };
}
