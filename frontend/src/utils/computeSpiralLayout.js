/**
 * computeSpiralLayout.js
 *
 * Maps an array of concept nodes onto a 3D helix (temporal spiral) where:
 *   Z axis  = time  (older nodes at z=0, newest nodes at z=MAX_Z, towards camera)
 *   Angle   = domain base offset + continuous time rotation
 *   Radius  = constant helix radius
 *
 * Returns a Map<concept_id, {x, y, z}> with fixed positions.
 * Also returns metadata: dateRange, domainAngles, timeBands.
 *
 * Usage:
 *   const { positions, timeBands, domainAngles } = computeSpiralLayout(nodes);
 *   const pos = positions.get(node.concept_id); // { x, y, z }
 */

// ── Domain angular offsets (radians) — each domain occupies its own arc sector ──
const DOMAIN_BASE_ANGLES = {
  'Machine Learning': 0,
  'Web Development':  Math.PI * 2 / 10,
  'System Design':    Math.PI * 4 / 10,
  'DSA':              Math.PI * 6 / 10,
  'DevOps':           Math.PI * 8 / 10,
  'Data Science':     Math.PI * 10 / 10,
  'Database':         Math.PI * 12 / 10,
  'API Design':       Math.PI * 14 / 10,
  'Cloud':            Math.PI * 16 / 10,
  'General':          Math.PI * 18 / 10,
};

// ── Layout constants ──────────────────────────────────────────────────────────
const HELIX_RADIUS     = 160;   // radius of the helix cylinder
const MAX_Z            = 600;   // total depth of the spiral (newest at MAX_Z)
const SPIRAL_TURNS     = 3;     // full rotations across the entire time range
const JITTER_SCALE     = 18;    // small random offset so nodes don't stack exactly
const MIN_NODE_Z_GAP   = 2;     // minimum z separation between same-domain nodes

/**
 * Deterministic pseudo-random jitter from a string seed (concept_id).
 * Returns a value in [-1, 1].
 */
function seededJitter(seed, axis) {
  let h = 0;
  const str = seed + axis;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return ((h & 0xffff) / 0xffff) * 2 - 1;
}

/**
 * computeSpiralLayout(nodes)
 *
 * @param {Array} nodes — array of concept objects from useGraph()
 * @returns {{
 *   positions:    Map<string, {x,y,z}>,
 *   timeBands:    Array<{z, label, date}>,
 *   domainAngles: Map<string, number>,
 *   dateRange:    {earliest: Date, latest: Date} | null,
 * }}
 */
export function computeSpiralLayout(nodes) {
  if (!nodes || nodes.length === 0) {
    return { positions: new Map(), timeBands: [], domainAngles: new Map(), dateRange: null };
  }

  // ── 1. Parse timestamps — fall back to index if missing ──────────────────
  const withTime = nodes.map((n, idx) => {
    const ts = n.created_at
      ? new Date(n.created_at).getTime()
      : null;
    return { node: n, ts, idx };
  });

  const validTs  = withTime.filter(w => w.ts !== null && !isNaN(w.ts));
  const earliest = validTs.length > 0 ? Math.min(...validTs.map(w => w.ts)) : Date.now() - 86400000;
  const latest   = validTs.length > 0 ? Math.max(...validTs.map(w => w.ts)) : Date.now();
  const range    = latest - earliest || 1;

  // ── 2. Assign t ∈ [0, 1] for each node ───────────────────────────────────
  const withT = withTime.map(w => ({
    ...w,
    t: w.ts !== null && !isNaN(w.ts)
      ? (w.ts - earliest) / range              // time-based
      : w.idx / Math.max(1, nodes.length - 1), // index fallback
  }));

  // ── 3. Compute helix positions ────────────────────────────────────────────
  const positions = new Map();

  for (const { node, t } of withT) {
    const domain     = node.domain || 'General';
    const baseAngle  = DOMAIN_BASE_ANGLES[domain] ?? (Math.random() * Math.PI * 2);
    const helixAngle = baseAngle + t * SPIRAL_TURNS * Math.PI * 2;

    const jx = seededJitter(node.concept_id, 'x') * JITTER_SCALE;
    const jy = seededJitter(node.concept_id, 'y') * JITTER_SCALE;
    const jz = seededJitter(node.concept_id, 'z') * (JITTER_SCALE * 0.5);

    positions.set(node.concept_id, {
      x: HELIX_RADIUS * Math.cos(helixAngle) + jx,
      y: HELIX_RADIUS * Math.sin(helixAngle) + jy,
      z: t * MAX_Z + jz,   // oldest at z≈0, newest at z≈MAX_Z
    });
  }

  // ── 4. Build time band rings (one per week or month depending on range) ───
  const timeBands = [];
  const rangeDays = range / 86400000;

  // Decide band granularity
  const bandInterval = rangeDays <= 14
    ? { unit: 'day',   ms: 86400000 }
    : rangeDays <= 90
    ? { unit: 'week',  ms: 7 * 86400000 }
    : { unit: 'month', ms: 30 * 86400000 };

  const bandCount = Math.min(Math.ceil(rangeDays / (bandInterval.ms / 86400000)), 24);

  for (let i = 0; i <= bandCount; i++) {
    const ts   = earliest + i * bandInterval.ms;
    const t    = Math.min((ts - earliest) / range, 1);
    const z    = t * MAX_Z;
    const date = new Date(ts);

    let label;
    if (bandInterval.unit === 'day') {
      label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } else if (bandInterval.unit === 'week') {
      label = 'W' + getWeekNumber(date) + ' ' + date.getFullYear();
    } else {
      label = date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    }

    timeBands.push({ z, label, date, t });
  }

  // ── 5. Domain angle map for legend ───────────────────────────────────────
  const domainAngles = new Map(
    Object.entries(DOMAIN_BASE_ANGLES)
  );

  return {
    positions,
    timeBands,
    domainAngles,
    dateRange: { earliest: new Date(earliest), latest: new Date(latest) },
  };
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
