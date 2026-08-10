import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { graphAPI } from '../api/client';

const DOMAIN_COLORS = {
  'Machine Learning': '#818cf8',
  'Web Development':  '#38bdf8',
  'System Design':    '#fbbf24',
  'DSA':              '#34d399',
  'DevOps':           '#f87171',
  'Data Science':     '#c084fc',
  'Database':         '#f472b6',
  'Cloud':            '#fb923c',
  'General':          '#94a3b8',
};
function domainColor(d) { return DOMAIN_COLORS[d] || '#94a3b8'; }

// ── D-range selector ──────────────────────────────────────────────────────────
const RANGES = [
  { label: '7 days',  value: 7  },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

// ── Bar chart (pure CSS + framer) ─────────────────────────────────────────────
function BarChart({ data, metric }) {
  const max = Math.max(...data.map(d => d[metric] || 0), 1);
  return (
    <div className="tl-chart">
      {data.map((d, i) => {
        const pct = ((d[metric] || 0) / max) * 100;
        const label = d.date.slice(5); // MM-DD
        return (
          <div key={d.date} className="tl-chart__col">
            <div className="tl-chart__bar-wrap">
              <div className="tl-chart__tooltip">
                <div className="tl-chart__tooltip-date">{d.date}</div>
                <div className="tl-chart__tooltip-val">{d[metric]} {metric === 'nodes_added' ? 'concepts' : 'edges'}</div>
                {d.domains?.length > 0 && (
                  <div className="tl-chart__tooltip-domains">
                    {d.domains.slice(0, 3).map(dm => (
                      <span key={dm} className="tl-chart__tooltip-chip"
                        style={{ background: domainColor(dm) + '33', color: domainColor(dm) }}>
                        {dm}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <motion.div
                className="tl-chart__bar"
                style={{ '--bar-color': pct > 0 ? '#818cf8' : 'transparent' }}
                initial={{ height: 0 }}
                animate={{ height: `${pct}%` }}
                transition={{ delay: i * 0.015, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            {data.length <= 14 && (
              <div className="tl-chart__label">{label}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Cumulative line (SVG sparkline) ───────────────────────────────────────────
function CumulativeLine({ data }) {
  const svgRef = useRef(null);
  if (!data.length) return null;
  const W = 100, H = 40;
  const maxVal = Math.max(...data.map(d => d.cumulative_nodes || 0), 1);
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * W;
    const y = H - ((d.cumulative_nodes || 0) / maxVal) * (H - 4);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="tl-sparkline-wrap">
      <span className="tl-sparkline-label">Cumulative growth</span>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="tl-sparkline">
        <polyline points={points} fill="none" stroke="#818cf8" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* end dot */}
        {data.length > 1 && (() => {
          const last = data[data.length - 1];
          const x = W;
          const y = H - ((last.cumulative_nodes || 0) / maxVal) * (H - 4);
          return <circle cx={x} cy={y} r="2" fill="#818cf8" />;
        })()}
      </svg>
      <span className="tl-sparkline-val">{data[data.length - 1]?.cumulative_nodes ?? 0} total</span>
    </div>
  );
}

// ── Streak calculator ─────────────────────────────────────────────────────────
function calcStreak(data) {
  if (!data.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const dateSet = new Set(data.filter(d => d.nodes_added > 0).map(d => d.date));
  let streak = 0;
  let cursor = new Date(today);
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!dateSet.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ── Domain activity chips ─────────────────────────────────────────────────────
function DomainActivity({ data }) {
  const counts = {};
  data.forEach(d => (d.domains || []).forEach(dm => {
    counts[dm] = (counts[dm] || 0) + 1;
  }));
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!sorted.length) return null;
  const max = sorted[0][1];
  return (
    <div className="tl-domains">
      {sorted.map(([name, count], i) => (
        <motion.div key={name} className="tl-domain-chip"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 + i * 0.04 }}
          style={{ '--dc': domainColor(name) }}>
          <span className="tl-domain-chip__dot" style={{ background: domainColor(name) }} />
          <span className="tl-domain-chip__name">{name}</span>
          <span className="tl-domain-chip__bar">
            <motion.span className="tl-domain-chip__fill"
              initial={{ width: 0 }}
              animate={{ width: `${(count / max) * 60}px` }}
              transition={{ delay: 0.4 + i * 0.04, duration: 0.5 }}
            />
          </span>
          <span className="tl-domain-chip__count">{count}d</span>
        </motion.div>
      ))}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function TimelinePage({ onBack }) {
  const [data,    setData]    = useState([]);
  const [range,   setRange]   = useState(30);
  const [metric,  setMetric]  = useState('nodes_added');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    graphAPI.getTimeline(range)
      .then(r => setData(r.data || []))
      .catch(() => setError('Could not load timeline data.'))
      .finally(() => setLoading(false));
  }, [range]);

  const totalNodes = data.reduce((s, d) => s + (d.nodes_added || 0), 0);
  const totalEdges = data.reduce((s, d) => s + (d.edges_added || 0), 0);
  const activeDays = data.filter(d => d.nodes_added > 0).length;
  const streak     = calcStreak(data);
  const peakDay    = data.reduce((best, d) => (!best || d.nodes_added > best.nodes_added) ? d : best, null);

  return (
    <div className="fp-shell">
      {/* HEADER */}
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Knowledge Growth</div>
          <h1 className="fp-title">TIMELINE</h1>
        </div>
        {/* Range selector */}
        <div className="tl-range-btns">
          {RANGES.map(r => (
            <button key={r.value}
              className={`tl-range-btn ${range === r.value ? 'tl-range-btn--active' : ''}`}
              onClick={() => setRange(r.value)} data-cursor="hover">
              {r.label}
            </button>
          ))}
        </div>
      </motion.header>

      <motion.div className="fp-content"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}>

        {/* SUMMARY STATS */}
        <div className="tl-summary">
          {[
            { label: 'Concepts Added', value: totalNodes, color: '#818cf8' },
            { label: 'Edges Formed',   value: totalEdges, color: '#38bdf8' },
            { label: 'Active Days',    value: activeDays, color: '#34d399' },
            { label: 'Day Streak',     value: streak,     color: '#fbbf24' },
          ].map((s, i) => (
            <motion.div key={s.label} className="tl-stat"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.07 }}>
              <div className="tl-stat__value" style={{ color: s.color }}>{s.value}</div>
              <div className="tl-stat__label">{s.label}</div>
            </motion.div>
          ))}
          {peakDay && (
            <motion.div className="tl-stat tl-stat--wide"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.38 }}>
              <div className="tl-stat__value" style={{ color: '#c084fc' }}>{peakDay.nodes_added}</div>
              <div className="tl-stat__label">Peak Day · {peakDay.date}</div>
            </motion.div>
          )}
        </div>

        {/* METRIC TOGGLE */}
        <div className="tl-metric-toggle">
          <button className={`tl-metric-btn ${metric === 'nodes_added' ? 'tl-metric-btn--active' : ''}`}
            onClick={() => setMetric('nodes_added')} data-cursor="hover">
            Concepts
          </button>
          <button className={`tl-metric-btn ${metric === 'edges_added' ? 'tl-metric-btn--active' : ''}`}
            onClick={() => setMetric('edges_added')} data-cursor="hover">
            Edges
          </button>
        </div>

        {/* CHART */}
        {loading ? (
          <div className="fp-loading"><div className="fp-loading__ring" /></div>
        ) : error ? (
          <div className="fp-empty">
            <div className="fp-empty__icon">◇</div>
            <div className="fp-empty__title">No Timeline Data</div>
            <div className="fp-empty__sub">Capture some content and run the pipeline to see your knowledge growth.</div>
          </div>
        ) : data.length === 0 ? (
          <div className="fp-empty">
            <div className="fp-empty__icon">◈</div>
            <div className="fp-empty__title">Nothing Yet</div>
            <div className="fp-empty__sub">Start adding knowledge and your timeline will appear here.</div>
          </div>
        ) : (
          <>
            <motion.div className="tl-chart-card"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}>
              <div className="tl-chart-card__header">
                <span className="tl-chart-card__title">
                  {metric === 'nodes_added' ? 'Concepts' : 'Edges'} per day
                </span>
                <CumulativeLine data={data} />
              </div>
              <BarChart data={data} metric={metric} />
            </motion.div>

            {/* DOMAIN ACTIVITY */}
            <motion.div className="tl-section"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}>
              <div className="tl-section__label">Domain Activity</div>
              <DomainActivity data={data} />
            </motion.div>

            {/* DAILY LOG TABLE */}
            <motion.div className="tl-section"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}>
              <div className="tl-section__label">Daily Log</div>
              <div className="tl-log">
                {[...data].reverse().map((d, i) => (
                  <motion.div key={d.date} className="tl-log-row"
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + i * 0.02 }}>
                    <span className="tl-log-row__date">{d.date}</span>
                    <span className="tl-log-row__nodes">
                      <span className="tl-log-row__dot" style={{ background: '#818cf8' }} />
                      {d.nodes_added} concepts
                    </span>
                    <span className="tl-log-row__edges">
                      <span className="tl-log-row__dot" style={{ background: '#38bdf8' }} />
                      {d.edges_added} edges
                    </span>
                    <div className="tl-log-row__domains">
                      {(d.domains || []).slice(0, 3).map(dm => (
                        <span key={dm} className="tl-log-row__chip"
                          style={{ color: domainColor(dm), borderColor: domainColor(dm) + '44' }}>
                          {dm}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </motion.div>
    </div>
  );
}
