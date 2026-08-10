import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { memoryAPI } from '../api/client';

const DOMAIN_COLORS = {
  'Machine Learning': '#818cf8', 'Web Development': '#38bdf8',
  'System Design': '#fbbf24',   'DSA': '#34d399',
  'DevOps': '#f87171',          'Data Science': '#c084fc',
  'Database': '#f472b6',        'Cloud': '#fb923c',
  'General': '#94a3b8',
};
const domainColor = d => DOMAIN_COLORS[d] || '#94a3b8';

// Quality grades shown to the user after flipping the card
const GRADES = [
  { q: 0, label: 'Blackout',   sub: 'No memory at all',        color: '#ef4444' },
  { q: 1, label: 'Wrong',      sub: 'Barely recognised',        color: '#f87171' },
  { q: 2, label: 'Hard',       sub: 'Wrong but remembered',     color: '#fb923c' },
  { q: 3, label: 'Difficult',  sub: 'Correct with effort',      color: '#fbbf24' },
  { q: 4, label: 'Good',       sub: 'Slight hesitation',        color: '#34d399' },
  { q: 5, label: 'Perfect',    sub: 'Instant recall',           color: '#818cf8' },
];

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ done, total }) {
  const pct  = total > 0 ? done / total : 0;
  const r    = 22; const circ = 2 * Math.PI * r;
  return (
    <svg width="54" height="54" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3" />
      <motion.circle cx="27" cy="27" r={r} fill="none" stroke="#818cf8" strokeWidth="3"
        strokeLinecap="round" strokeDasharray={circ}
        animate={{ strokeDashoffset: circ - pct * circ }}
        transition={{ duration: 0.5, ease: 'easeOut' }} />
    </svg>
  );
}

// ── Flashcard ─────────────────────────────────────────────────────────────────
function Flashcard({ card, flipped, onFlip }) {
  const color  = domainColor(card.domain);
  const retPct = Math.round((1 - (card.forget_score || 0)) * 100);

  return (
    <div className="rv-card-scene" onClick={!flipped ? onFlip : undefined}>
      <motion.div className="rv-card"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformStyle: 'preserve-3d' }}>

        {/* FRONT */}
        <div className="rv-card__face rv-card__face--front">
          <div className="rv-card__bar" style={{ background: color }} />
          <div className="rv-card__domain" style={{ color }}>{card.domain}</div>
          <div className="rv-card__name">{card.name}</div>
          <div className="rv-card__retention">
            <span className="rv-card__ret-label">Current retention</span>
            <span className="rv-card__ret-val"
              style={{ color: retPct < 50 ? '#f87171' : retPct < 75 ? '#fbbf24' : '#34d399' }}>
              {retPct}%
            </span>
          </div>
          <div className="rv-card__flip-hint">Tap to reveal →</div>
        </div>

        {/* BACK */}
        <div className="rv-card__face rv-card__face--back">
          <div className="rv-card__bar" style={{ background: color }} />
          <div className="rv-card__domain" style={{ color }}>{card.domain}</div>
          <div className="rv-card__name rv-card__name--sm">{card.name}</div>
          <div className="rv-card__summary">{card.summary || 'No summary available.'}</div>
          {card.source_url && (
            <a className="rv-card__source" href={card.source_url}
              target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}>
              ↗ {card.source_url.replace(/^https?:\/\//, '').slice(0, 50)}
            </a>
          )}
          <div className="rv-card__stats">
            <div className="rv-card__stat">
              <span className="rv-card__stat-val">{card.rep_count}</span>
              <span className="rv-card__stat-label">Reviews</span>
            </div>
            <div className="rv-card__stat">
              <span className="rv-card__stat-val">{card.rep_interval}d</span>
              <span className="rv-card__stat-label">Interval</span>
            </div>
            <div className="rv-card__stat">
              <span className="rv-card__stat-val">{card.ease_factor}</span>
              <span className="rv-card__stat-label">Ease</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Grade buttons ─────────────────────────────────────────────────────────────
function GradeButtons({ onGrade, submitting }) {
  return (
    <motion.div className="rv-grades"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}>
      <div className="rv-grades__label">How well did you remember?</div>
      <div className="rv-grades__row">
        {GRADES.map(g => (
          <button key={g.q} className="rv-grade-btn"
            style={{ '--gc': g.color }}
            onClick={() => onGrade(g.q)}
            disabled={submitting}
            data-cursor="hover">
            <span className="rv-grade-btn__q">{g.q}</span>
            <span className="rv-grade-btn__label">{g.label}</span>
            <span className="rv-grade-btn__sub">{g.sub}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Session complete screen ───────────────────────────────────────────────────
function SessionComplete({ stats, onRestart, onBack }) {
  return (
    <motion.div className="rv-complete"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
      <div className="rv-complete__icon">◈</div>
      <h2 className="rv-complete__title">Session Complete</h2>
      <p className="rv-complete__sub">You reviewed {stats.total} concept{stats.total !== 1 ? 's' : ''}.</p>
      <div className="rv-complete__stats">
        {[
          { label: 'Reviewed',  val: stats.total,   color: '#818cf8' },
          { label: 'Passed',    val: stats.passed,  color: '#34d399' },
          { label: 'Struggled', val: stats.failed,  color: '#f87171' },
          { label: 'Avg Grade', val: stats.total > 0 ? (stats.gradeSum / stats.total).toFixed(1) : '—', color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} className="rv-complete__stat">
            <div className="rv-complete__stat-val" style={{ color: s.color }}>{s.val}</div>
            <div className="rv-complete__stat-label">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="rv-complete__actions">
        <button className="rv-complete__btn rv-complete__btn--primary"
          onClick={onRestart} data-cursor="hover">Review Again</button>
        <button className="rv-complete__btn" onClick={onBack} data-cursor="hover">← Dashboard</button>
      </div>
    </motion.div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function ReviewPage({ onBack }) {
  const [queue,      setQueue]      = useState([]);
  const [idx,        setIdx]        = useState(0);
  const [flipped,    setFlipped]    = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [stats,      setStats]      = useState({ total: 0, passed: 0, failed: 0, gradeSum: 0 });
  const [toast,      setToast]      = useState(null);

  const loadQueue = useCallback(() => {
    setLoading(true); setIdx(0); setFlipped(false); setDone(false);
    setStats({ total: 0, passed: 0, failed: 0, gradeSum: 0 });
    memoryAPI.getReviewQueue(0.4, 30)
      .then(r => setQueue(r.data?.queue || []))
      .catch(() => setQueue([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const showToast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 1800);
  };

  const handleGrade = useCallback(async (quality) => {
    if (submitting || !queue[idx]) return;
    setSubmitting(true);
    const card = queue[idx];
    try {
      await memoryAPI.review(card.concept_id, quality);
    } catch { /* silent — don't block UX */ }

    const passed = quality >= 3;
    setStats(s => ({
      total:    s.total + 1,
      passed:   s.passed + (passed ? 1 : 0),
      failed:   s.failed + (passed ? 0 : 1),
      gradeSum: s.gradeSum + quality,
    }));

    const grade = GRADES.find(g => g.q === quality);
    showToast(grade.label, grade.color);

    const next = idx + 1;
    if (next >= queue.length) {
      setTimeout(() => setDone(true), 600);
    } else {
      setTimeout(() => { setIdx(next); setFlipped(false); setSubmitting(false); }, 400);
      return;
    }
    setSubmitting(false);
  }, [idx, queue, submitting]);

  const card = queue[idx];

  return (
    <div className="fp-shell rv-shell">
      {/* HEADER */}
      <motion.header className="fp-header"
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}>
        <button className="fp-back" onClick={onBack} data-cursor="hover">← Back</button>
        <div className="fp-header__center">
          <div className="fp-eyebrow">Spaced Repetition</div>
          <h1 className="fp-title">ACTIVE REVIEW</h1>
        </div>
        {!done && !loading && queue.length > 0 && (
          <div className="rv-progress">
            <ProgressRing done={idx} total={queue.length} />
            <div className="rv-progress__text">
              <span className="rv-progress__cur">{idx + 1}</span>
              <span className="rv-progress__sep">/</span>
              <span className="rv-progress__tot">{queue.length}</span>
            </div>
          </div>
        )}
      </motion.header>

      <div className="rv-body">

        {loading && <div className="fp-loading"><div className="fp-loading__ring" /></div>}

        {!loading && queue.length === 0 && !done && (
          <div className="fp-empty">
            <div className="fp-empty__icon" style={{ color: '#34d399' }}>◈</div>
            <div className="fp-empty__title">Nothing to Review</div>
            <div className="fp-empty__sub">
              All your concepts are well-retained. Come back after the nightly pipeline runs,
              or lower the threshold to review more cards.
            </div>
            <button className="rv-reload-btn" onClick={loadQueue} data-cursor="hover">
              Reload Queue
            </button>
          </div>
        )}

        {!loading && !done && card && (
          <div className="rv-session">
            <AnimatePresence mode="wait">
              <motion.div key={card.concept_id}
                initial={{ opacity: 0, x: 40, scale: 0.97 }}
                animate={{ opacity: 1, x: 0,  scale: 1   }}
                exit={{    opacity: 0, x: -40, scale: 0.97 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
                <Flashcard card={card} flipped={flipped} onFlip={() => setFlipped(true)} />
              </motion.div>
            </AnimatePresence>

            {flipped && (
              <GradeButtons onGrade={handleGrade} submitting={submitting} />
            )}

            {!flipped && (
              <motion.div className="rv-hint-row"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}>
                <span className="rv-hint">Try to recall the concept, then tap the card to reveal.</span>
              </motion.div>
            )}
          </div>
        )}

        {done && (
          <SessionComplete stats={stats} onRestart={loadQueue} onBack={onBack} />
        )}

        {/* Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div className="rv-toast"
              style={{ '--tc': toast.color }}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0,  scale: 1   }}
              exit={{    opacity: 0, y: -10, scale: 0.9 }}
              transition={{ duration: 0.25 }}>
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
