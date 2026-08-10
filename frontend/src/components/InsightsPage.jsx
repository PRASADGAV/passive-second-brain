import { useState, useEffect } from 'react';
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
const domainColor = d => DOMAIN_COLORS[d] || '#94a3b8';

// ── Top concept row ───────────────────────────────────────────────────────────
function TopConceptRow({ node, rank, maxEdges }) {
  const pct = maxEdges > 0 ? (node.edge_count / maxEdges) * 100 : 0;
  const color = domainColor(node.domain);
  return (
    <motion.div className="ins-concept-row"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + rank * 0.06, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
      <span className="ins-concept-row__rank">#{rank + 1}</span>
      <div className="ins-concept-row__info">
        <div className="ins-concept-row__name">{node.name}</div>
        <div className="ins-concept-row__bar">
          <motion.div className="ins-concept-row__fill"
            style={{ background: color }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ delay: 0.2 + rank * 0.06, duration: 0.6, ease: 'easeOut' }} />
        </div>
      </div>
      <span className="ins-concept-row__domain" style={{ color }}>{node.domain}</span>
      <span className="ins-concept-row__edges">{node.edge_count}</span>
    </motion.div>
  );
}

// ── Community cluster card ────────────────────────────────────────────────────
function CommunityCard({ community, idx }) {
  const colors = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#f472b6'];
  const color = colors[idx % colors.length];
  return (
    <motion.div className="ins-community-card"
      style={{ '--cc': color }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 + idx * 0.07, duration: 0.5 }}>
      <div className="ins-community-card__header">
        <span className="ins-community-card__label">Cluster {idx + 1}</span>
        <span className="ins-community-card__size">{community.size} concepts</span>
      </div>
      <div className="ins-community-card__concepts">
        {community.top_concepts.map(name => (
          <span key={name} className="ins-community-card__chip">{name}</span>
        ))}
      </div>
    </motion.div>
  );
}

// ── Memory stat row ───────────────────────────────────────────────────────────
function MemoryRow({ node, idx, type }) {
  const isForgotten = type === 'forgotten';
  const val   = isForgotten ? `${Math.round((node.forget_score || 0) * 100)}%` : `${node.rep_count}×`;
  const color = isForgotten
    ? (node.forget_score > 0.7 ? '#f87171' : '#fbbf24')
    : '#34d399';
  return (
    <motion.div className="ins-memory-row"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + idx * 0.06 }}>
      <div className="ins-memory-row__info">
        <span className="ins-memory-row__name">{node.name}</span>
        <span className="ins-memory-row__domain" style={{ color: domainColor(node.domain) }}>
          {node.domain}
        </span>
      </div>
      <span className="ins-memory-row__val" style={{ color }}>{val}</span>
    </motion.div>
  );
}

// ── Domain distribution bar ───────────────────────────────────────────────────
function DomainDistribution({ domains }) {
  const entries = Object.entries(domains).sort((a, b) => b[1] - a[1]);
  const total   = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="ins-domain-dist">
      <div className="ins-domain-dist__bar">
        {entries.map(([name, count]) => (
          <motion.div key={name} className="ins-domain-dist__seg"
            style={{ background: domainColor(name) }}
            initial={{ width: 0 }}
            animate={{ width: `${(count / total) * 100}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            title={`${name}: ${count}`} />
        ))}
      </div>
      <div className="ins-domain-dist__legend">
        {entries.slice(0, 6).map(([name, count]) => (
          <div key={name} className="ins-domain-dist__item">
            <span className="ins-domain-dist__dot" style={{ background: domainColor(name) }} />
            <span className="ins-domain-dist__name">{name}</span>
            <span className="ins-domain-dist__count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function InsightsPage({ onBack }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    graphAPI.getInsights()
      .then(r => setData(r.data))
      .catch(() => setError('Could not load insights.'))
      .finally(() => setLoading(false));
  }, []);

  const maxEdges = data?.top_concepts
    ? Math.max(...data.top_concepts.map(c => c.edge_count), 1)
    : 1;

  return (
    <div className="fp-shell">
      {/* HEADER */}
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Graph Intelligence</div>
          <h1 className="fp-title">INSIGHTS</h1>
        </div>
        <div />
      </motion.header>

      <motion.div className="fp-content"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}>

        {loading && <div className="fp-loading"><div className="fp-loading__ring" /></div>}

        {error && (
          <div className="fp-empty">
            <div className="fp-empty__icon">◇</div>
            <div className="fp-empty__title">Could not load insights</div>
            <div className="fp-empty__sub">Make sure the backend is running and the pipeline has run at least once.</div>
          </div>
        )}

        {data && (
          <div className="ins-grid">

            {/* ── Top Concepts (PageRank) ── */}
            <motion.div className="ins-card ins-card--wide"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}>
              <div className="ins-card__header">
                <div className="ins-card__eyebrow">Most Connected</div>
                <h2 className="ins-card__title">Core Concepts</h2>
                <p className="ins-card__sub">Ranked by connections in your knowledge graph</p>
              </div>
              {data.top_concepts.length === 0 ? (
                <p className="ins-empty-msg">No concepts yet — add some knowledge first.</p>
              ) : (
                <div className="ins-concept-list">
                  {data.top_concepts.map((c, i) => (
                    <TopConceptRow key={c.concept_id} node={c} rank={i} maxEdges={maxEdges} />
                  ))}
                </div>
              )}
            </motion.div>

            {/* ── Domain Distribution ── */}
            {Object.keys(data.domain_counts || {}).length > 0 && (
              <motion.div className="ins-card"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}>
                <div className="ins-card__header">
                  <div className="ins-card__eyebrow">Breakdown</div>
                  <h2 className="ins-card__title">Domain Map</h2>
                </div>
                <DomainDistribution domains={data.domain_counts} />
              </motion.div>
            )}

            {/* ── Memory: Most Forgotten ── */}
            <motion.div className="ins-card"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}>
              <div className="ins-card__header">
                <div className="ins-card__eyebrow">Needs Review</div>
                <h2 className="ins-card__title">Most Forgotten</h2>
              </div>
              {data.most_forgotten.length === 0 ? (
                <p className="ins-empty-msg">Nothing fading — great retention!</p>
              ) : (
                <div className="ins-memory-list">
                  {data.most_forgotten.map((n, i) => (
                    <MemoryRow key={n.concept_id} node={n} idx={i} type="forgotten" />
                  ))}
                </div>
              )}
            </motion.div>

            {/* ── Memory: Most Reviewed ── */}
            <motion.div className="ins-card"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}>
              <div className="ins-card__header">
                <div className="ins-card__eyebrow">Well Studied</div>
                <h2 className="ins-card__title">Most Reviewed</h2>
              </div>
              {data.most_reviewed.length === 0 ? (
                <p className="ins-empty-msg">No reviews yet — try the Review button on any concept.</p>
              ) : (
                <div className="ins-memory-list">
                  {data.most_reviewed.map((n, i) => (
                    <MemoryRow key={n.concept_id} node={n} idx={i} type="reviewed" />
                  ))}
                </div>
              )}
            </motion.div>

            {/* ── Topic Clusters ── */}
            {data.communities?.length > 0 && (
              <motion.div className="ins-card ins-card--wide"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}>
                <div className="ins-card__header">
                  <div className="ins-card__eyebrow">Auto-detected</div>
                  <h2 className="ins-card__title">Topic Clusters</h2>
                  <p className="ins-card__sub">Groups of tightly connected concepts in your graph</p>
                </div>
                <div className="ins-community-grid">
                  {data.communities.map((c, i) => (
                    <CommunityCard key={c.id} community={c} idx={i} />
                  ))}
                </div>
              </motion.div>
            )}

          </div>
        )}
      </motion.div>
    </div>
  );
}
