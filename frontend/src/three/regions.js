export const REGIONS = [
  { id: 'attention',  label: 'ATTENTION · ML',     direction: [ 0.6,  0.5,  0.6] },
  { id: 'memory',     label: 'SM-2 · MEMORY',       direction: [-0.5,  0.3,  0.7] },
  { id: 'graph',      label: 'KNOWLEDGE GRAPH',     direction: [ 0.0,  0.7, -0.6] },
  { id: 'rag',        label: 'RAG · CHAT',          direction: [-0.7,  0.1, -0.4] },
  { id: 'ingestion',  label: 'PASSIVE CAPTURE',     direction: [ 0.7, -0.4, -0.3] },
  { id: 'gaps',       label: 'GAP ANALYSIS',        direction: [-0.3, -0.6,  0.5] },
];

export function nearestRegion(hitPoint, center = [0, 0, 0]) {
  let best    = null;
  let bestDot = -Infinity;
  const hx = hitPoint.x - center[0];
  const hy = hitPoint.y - center[1];
  const hz = hitPoint.z - center[2];
  const len = Math.hypot(hx, hy, hz) || 1;
  const nx = hx / len, ny = hy / len, nz = hz / len;

  for (const region of REGIONS) {
    const [rx, ry, rz] = region.direction;
    const rlen = Math.hypot(rx, ry, rz) || 1;
    const dot  = (nx * rx + ny * ry + nz * rz) / rlen;
    if (dot > bestDot) { bestDot = dot; best = region; }
  }
  return best;
}
