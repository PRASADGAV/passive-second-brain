import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as d3 from 'd3';

/**
 * GraphCanvas — D3 force-directed graph.
 * OBYS editorial: white background, black nodes, thin borders, no glows.
 */

// Domain colours — desaturated, ink-friendly
const DOMAIN_COLORS = [
  '#0D0D0D', '#444444', '#666666', '#888888',
  '#AAAAAA', '#333333', '#555555', '#777777',
  '#999999', '#222222',
];

const DOMAIN_COLOR_SCALE = d3.scaleOrdinal().range(DOMAIN_COLORS);

const GraphCanvas = forwardRef(({ nodes = [], edges = [], onNodeClick, searchTerm = '' }, ref) => {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useImperativeHandle(ref, () => ({
    exportPNG() {
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(svgEl);
      if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FAFAF8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        const pngUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const today = new Date().toISOString().split('T')[0];
        link.href = pngUrl;
        link.download = `psb-graph-export-${today}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };
      image.src = url;
    },
  }));

  useEffect(() => {
    const updateSize = () => {
      if (svgRef.current) {
        const rect = svgRef.current.parentElement.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;
    const isLargeGraph = nodes.length > 500;

    const getNodeWidth = d => Math.max(88, (d.name?.length || 0) * 7 + 24);

    const nodeData = nodes.map((n, index) => {
      const baseRadius = 4 + Math.sqrt((n.edge_count || 0) + (n.rep_count || 0)) * 1.6;
      const radius = Math.min(isLargeGraph ? baseRadius * 0.7 : baseRadius, 16);
      return { ...n, id: n.concept_id, radius, domain: n.domain || 'General', phase: (index % 9) * 0.7 };
    });

    const nodeIds = new Set(nodeData.map(n => n.id));
    const edgeData = edges
      .filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
      .map(e => ({ ...e, source: e.source_id, target: e.target_id }));

    const domainNames = Array.from(new Set(nodeData.map(n => n.domain)));
    DOMAIN_COLOR_SCALE.domain(domainNames);

    const sphereRadius = Math.min(width, height) * 0.2;

    nodeData.forEach((node, index) => {
      const degreeBoost = Math.max(0, (node.edge_count || 0) * 1.0);
      const orbit = sphereRadius + degreeBoost + ((index % 6) * 2.4);
      const angle = ((index / Math.max(nodeData.length, 1)) * Math.PI * 2) + ((node.domain?.length || 0) % 5) * 0.16;
      node.clusterX = width / 2 + Math.cos(angle) * orbit;
      node.clusterY = height / 2 + Math.sin(angle) * orbit * 0.86;
      node.x = node.clusterX;
      node.y = node.clusterY;
    });

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const container = svg.append('g');

    // Edges
    const edgeLayer = container.append('g').attr('class', 'graph-edges');
    const link = edgeLayer.selectAll('path')
      .data(edgeData)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(13,13,13,0.12)')
      .attr('stroke-width', 1)
      .attr('stroke-linecap', 'round')
      .attr('opacity', 1);

    // Nodes
    const nodeLayer = container.append('g').attr('class', 'graph-nodes');
    const node = nodeLayer.selectAll('g.concept-node')
      .data(nodeData)
      .join('g')
      .attr('class', 'concept-node')
      .style('cursor', 'pointer');

    // Node cards
    node.append('rect')
      .attr('x', d => -getNodeWidth(d) / 2)
      .attr('y', -14)
      .attr('width', d => getNodeWidth(d))
      .attr('height', 28)
      .attr('rx', 0)
      .attr('ry', 0)
      .attr('fill', '#FAFAF8')
      .attr('stroke', d => DOMAIN_COLOR_SCALE(d.domain))
      .attr('stroke-width', 1);

    // Domain colour strip at left edge of card
    node.append('rect')
      .attr('x', d => -getNodeWidth(d) / 2)
      .attr('y', -14)
      .attr('width', 3)
      .attr('height', 28)
      .attr('fill', d => DOMAIN_COLOR_SCALE(d.domain));

    // Node label
    node.append('text')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px')
      .attr('fill', '#0D0D0D')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text(d => d.name || '');

    const highlightedIds = new Set();

    const setHighlight = activeNodeId => {
      const active = activeNodeId ? nodeData.find(n => n.id === activeNodeId) : null;
      highlightedIds.clear();
      if (!active) {
        link.attr('stroke', 'rgba(13,13,13,0.12)').attr('stroke-width', 1);
        node.select('rect:first-of-type').attr('fill', '#FAFAF8').attr('stroke-width', 1);
        node.select('text').attr('fill', '#0D0D0D');
        return;
      }

      const connected = new Set();
      edgeData.forEach(edge => {
        const srcId = edge.source.id || edge.source;
        const tgtId = edge.target.id || edge.target;
        if (srcId === active.id || tgtId === active.id) {
          connected.add(srcId);
          connected.add(tgtId);
        }
      });
      connected.forEach(id => highlightedIds.add(id));
      highlightedIds.add(active.id);

      link
        .attr('stroke', edge => {
          const srcId = edge.source.id || edge.source;
          const tgtId = edge.target.id || edge.target;
          return srcId === active.id || tgtId === active.id ? 'rgba(13,13,13,0.6)' : 'rgba(13,13,13,0.05)';
        })
        .attr('stroke-width', edge => {
          const srcId = edge.source.id || edge.source;
          const tgtId = edge.target.id || edge.target;
          return srcId === active.id || tgtId === active.id ? 1.8 : 0.8;
        });

      node.select('rect:first-of-type')
        .attr('fill', d => d.id === active.id ? '#0D0D0D' : '#FAFAF8')
        .attr('stroke-width', d => d.id === active.id ? 1.5 : 1);

      node.select('text')
        .attr('fill', d => d.id === active.id ? '#FAFAF8' : connected.has(d.id) ? '#0D0D0D' : 'rgba(13,13,13,0.3)');
    };

    if (!isLargeGraph) {
      node.on('mouseenter', (_e, d) => setHighlight(d.id));
      node.on('mouseleave', () => setHighlight(null));
    }

    node.on('click', (_e, d) => { if (onNodeClick) onNodeClick(d); });

    const drag = d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) simRef.current?.alphaTarget(0);
        d.fx = null; d.fy = null;
      });

    node.call(drag);

    const simulation = d3.forceSimulation(nodeData)
      .force('link', d3.forceLink(edgeData).id(d => d.id).distance(90).strength(0.05))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(d => d.radius + 20))
      .force('x', d3.forceX(d => d.clusterX).strength(0.08))
      .force('y', d3.forceY(d => d.clusterY).strength(0.08))
      .on('tick', () => {
        link.attr('d', d => {
          const src = d.source, tgt = d.target;
          const midX = (src.x + tgt.x) / 2;
          const midY = (src.y + tgt.y) / 2;
          const dx = tgt.x - src.x, dy = tgt.y - src.y;
          const dist = Math.hypot(dx, dy) || 1;
          const curve = 24 + Math.min(40, dist * 0.1);
          const ox = (-dy / dist) * curve, oy = (dx / dist) * curve;
          return `M ${src.x} ${src.y} Q ${midX + ox} ${midY + oy} ${tgt.x} ${tgt.y}`;
        });
        node.attr('transform', d => `translate(${d.x}, ${d.y})`);
      });

    simRef.current = simulation;
    return () => simulation.stop();
  }, [nodes, edges, dimensions, onNodeClick]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      svg.selectAll('.concept-node').style('opacity', 1);
      return;
    }
    svg.selectAll('.concept-node').style('opacity', d =>
      d.name?.toLowerCase().includes(term) ? 1 : 0.15
    );
  }, [searchTerm]);

  if (nodes.length === 0) {
    return (
      <div className="graph-empty">
        <div className="graph-empty__title">No Concepts Yet</div>
        <div className="graph-empty__text">
          Start browsing or add a URL to build your knowledge graph.
        </div>
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={dimensions.width}
      height={dimensions.height}
      style={{ display: 'block', width: '100%', height: '100%', background: '#FAFAF8' }}
    />
  );
});

export default GraphCanvas;
