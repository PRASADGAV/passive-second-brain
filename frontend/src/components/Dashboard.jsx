import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { graphAPI, pipelineAPI, memoryAPI } from '../api/client';
import { useTheme } from '../context/ThemeContext';

// ── Domain colours ────────────────────────────────────────────────────────────
const DOMAIN_COLORS = {
  'Machine Learning': '#818cf8',
  'Web Development':  '#38bdf8',
  'System Design':    '#fbbf24',
  'DSA':              '#34d399',
  'DevOps':           '#f87171',
  'Data Science':     '#c084fc',
  'Database':         '#f472b6',
  'API Design':       '#2dd4bf',
  'Cloud':            '#fb923c',
  'General':          '#94a3b8',
};
function domainColor(d) { return DOMAIN_COLORS[d] || '#94a3b8'; }

// ── Live clock ────────────────────────────────────────────────────────────────
function useClock() {
  const [t, setT] = useState({ time: '', date: '', seconds: 0 });
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setT({
        time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        seconds: now.getSeconds(),
        date: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ value, duration = 1.4 }) {
  const [display, setDisplay] = useState(0);
  const target = parseInt(value) || 0;
  useEffect(() => {
    let start = 0;
    const step = target / (duration * 60);
    const id = setInterval(() => {
      start += step;
      if (start >= target) { setDisplay(target); clearInterval(id); }
      else setDisplay(Math.floor(start));
    }, 1000 / 60);
    return () => clearInterval(id);
  }, [target, duration]);
  return <>{display}</>;
}

// ── Theme toggle button ───────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <motion.button
      className="engram-theme-btn"
      onClick={toggle}
      whileTap={{ scale: 0.9 }}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      data-cursor="hover"
    >
      <motion.span
        key={theme}
        initial={{ opacity: 0, rotate: -30, scale: 0.7 }}
        animate={{ opacity: 1, rotate: 0,   scale: 1 }}
        exit={{ opacity: 0, rotate: 30, scale: 0.7 }}
        transition={{ duration: 0.25 }}
        className="engram-theme-btn__icon"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </motion.span>
    </motion.button>
  );
}

// ── Animated ring progress ────────────────────────────────────────────────────
function RingProgress({ pct, color, size = 72, stroke = 5 }) {
  const { isDark } = useTheme();
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const trackColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <motion.circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - (pct / 100) * circ }}
        transition={{ duration: 1.4, ease: 'easeOut', delay: 0.4 }}
      />
    </svg>
  );
}

// ── Particle background canvas — optimised ───────────────────────────────────
function NeuralBg() {
  const { isDark } = useTheme();
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width  = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    // 35 particles (was 60), connect distance 80 (was 120) → 3× fewer line ops
    const pts = Array.from({ length: 35 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
      r: Math.random() * 1.1 + 0.3,
    }));
    const CONNECT_DIST = 80;
    let raf;
    const lineAlpha = isDark ? 0.07 : 0.04;
    const dotColor  = isDark ? 'rgba(139,92,246,0.22)' : 'rgba(99,102,241,0.13)';
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < CONNECT_DIST * CONNECT_DIST) {
            const a = lineAlpha * (1 - Math.sqrt(d2) / CONNECT_DIST);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(99,102,241,${a})`;
            ctx.lineWidth = 0.5; ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = dotColor; ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [isDark]);
  return <canvas ref={canvasRef} className="db3-neural-canvas" />;
}

// ── Clock ring ────────────────────────────────────────────────────────────────
function ClockDisplay({ time, date, seconds }) {
  const { isDark } = useTheme();
  const trackStroke = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
  const tickStroke  = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
  return (
    <div className="db3-clock-wrap">
      <div className="db3-clock-ring">
        <svg className="db3-clock-svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" fill="none" stroke={trackStroke} strokeWidth="1.5" />
          <motion.circle cx="50" cy="50" r="44" fill="none" stroke="#818cf8" strokeWidth="1.5"
            strokeLinecap="round" strokeDasharray="276.46"
            animate={{ strokeDashoffset: 276.46 - (seconds / 60) * 276.46 }}
            transition={{ duration: 0.4, ease: 'linear' }}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
          {Array.from({ length: 12 }, (_, i) => {
            const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
            return <line key={i}
              x1={50 + 38 * Math.cos(ang)} y1={50 + 38 * Math.sin(ang)}
              x2={50 + 42 * Math.cos(ang)} y2={50 + 42 * Math.sin(ang)}
              stroke={tickStroke} strokeWidth="1" />;
          })}
        </svg>
        <div className="db3-clock-inner">
          <div className="db3-clock-time">{time}</div>
        </div>
      </div>
      <div className="db3-clock-date">{date}</div>
    </div>
  );
}

// ── Feature tile — simple hover, no 3D tilt overhead ─────────────────────────
function FeatureTile({ id, icon, label, desc, color, onClick, delay = 0, size = 'normal' }) {
  return (
    <motion.div
      className={`db3-tile db3-tile--${size}`}
      style={{ '--tc': color }}
      onClick={() => onClick(id)}
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3, scale: 1.015, transition: { duration: 0.18 } }}
      whileTap={{ scale: 0.97 }}
      data-cursor="hover"
    >
      <div className="db3-tile__glow" />
      <div className="db3-tile__top">
        <div className="db3-tile__icon" style={{ color }}>{icon}</div>
        <div className="db3-tile__arrow">↗</div>
      </div>
      <div className="db3-tile__label">{label}</div>
      <div className="db3-tile__desc">{desc}</div>
      <div className="db3-tile__bar" style={{ background: color }} />
    </motion.div>
  );
}

// ── Mini stat card ────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon, warn, delay }) {
  return (
    <motion.div className="db3-stat-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="db3-stat-card__top">
        <span className="db3-stat-card__icon">{icon}</span>
        {warn && <span className="db3-stat-card__warn-dot" />}
      </div>
      <div className={`db3-stat-card__value ${warn ? 'db3-stat-card__value--warn' : ''}`}
        style={{ color: warn ? '#f87171' : color }}>
        {value}
      </div>
      <div className="db3-stat-card__label">{label}</div>
      <motion.div className="db3-stat-card__shine"
        initial={{ x: '-100%' }} animate={{ x: '200%' }}
        transition={{ delay: delay + 0.3, duration: 0.8, ease: 'easeInOut' }}
      />
    </motion.div>
  );
}

// ── Pipeline chip ─────────────────────────────────────────────────────────────
function PipelineChip({ status }) {
  const cfg = {
    running: { color: '#34d399', label: 'Pipeline Running', pulse: true },
    failed:  { color: '#f87171', label: 'Pipeline Failed',  pulse: false },
    idle:    { color: '#94a3b8', label: 'Pipeline Idle',    pulse: false },
  }[status] || { color: '#94a3b8', label: 'Unknown', pulse: false };
  return (
    <div className="db3-chip" style={{ '--chip-color': cfg.color }}>
      <span className={`db3-chip__dot ${cfg.pulse ? 'db3-chip__dot--pulse' : ''}`}
        style={{ background: cfg.color }} />
      {cfg.label}
    </div>
  );
}

// ── Domain bar ────────────────────────────────────────────────────────────────
function DomainBar({ name, count, total, delay }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const color = domainColor(name);
  return (
    <motion.div className="db3-domain-row"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="db3-domain-dot" style={{ background: color }} />
      <span className="db3-domain-name">{name}</span>
      <div className="db3-domain-track">
        <motion.div className="db3-domain-fill" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.1, duration: 0.7, ease: 'easeOut' }} />
      </div>
      <span className="db3-domain-count">{count}</span>
    </motion.div>
  );
}

// ── Fading memory row ─────────────────────────────────────────────────────────
function FadingRow({ alert, idx }) {
  const pct = Math.round((1 - (alert.forget_score || 0)) * 100);
  const clr = pct < 50 ? '#f87171' : pct < 75 ? '#fbbf24' : '#34d399';
  return (
    <motion.div className="db3-fading-row"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5 + idx * 0.06, duration: 0.4 }}
    >
      <div className="db3-fading-row__left">
        <span className="db3-fading-row__name">{alert.name || alert.concept_name}</span>
        <div className="db3-fading-row__track">
          <motion.div className="db3-fading-row__fill" style={{ background: clr }}
            initial={{ width: 0 }} animate={{ width: `${pct}%` }}
            transition={{ delay: 0.6 + idx * 0.06, duration: 0.5, ease: 'easeOut' }} />
        </div>
      </div>
      <span className="db3-fading-row__pct" style={{ color: clr }}>{pct}%</span>
    </motion.div>
  );
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────
export default function Dashboard({ onNavigate, wsConnected }) {
  const { time, date, seconds } = useClock();
  const [stats,    setStats]    = useState(null);
  const [alerts,   setAlerts]   = useState([]);
  const [pipeline, setPipeline] = useState({ status: 'idle' });
  const [domains,  setDomains]  = useState([]);
  const [ready,    setReady]    = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerDone, setTriggerDone] = useState(false);

  const handleRunNow = async () => {
    if (triggering || pipeline.status === 'running') return;
    setTriggering(true);
    try {
      await pipelineAPI.trigger();
      setPipeline({ status: 'running' });
      setTriggerDone(false);
      // Poll until done
      const poll = setInterval(async () => {
        try {
          const r = await pipelineAPI.getStatus();
          setPipeline(r.data);
          if (r.data?.status !== 'running') {
            clearInterval(poll);
            setTriggering(false);
            if (r.data?.status !== 'failed') {
              setTriggerDone(true);
              setTimeout(() => setTriggerDone(false), 4000);
            }
          }
        } catch { clearInterval(poll); setTriggering(false); }
      }, 3000);
    } catch (err) {
      if (err.response?.status !== 409) console.warn('Pipeline trigger failed', err);
      setTriggering(false);
    }
  };

  useEffect(() => {
    Promise.allSettled([
      graphAPI.getStats(),
      memoryAPI.getAlerts(0.6),
      pipelineAPI.getStatus(),
    ]).then(([s, a, p]) => {
      if (s.status === 'fulfilled') {
        setStats(s.value.data);
        setDomains(Object.entries(s.value.data?.domains || {}).sort((a, b) => b[1] - a[1]).slice(0, 6));
      }
      if (a.status === 'fulfilled') setAlerts(a.value.data?.alerts || []);
      if (p.status === 'fulfilled') setPipeline(p.value.data);
      setReady(true);
    });
    const iv = setInterval(() =>
      pipelineAPI.getStatus().then(r => setPipeline(r.data)).catch(() => {}), 30000);
    return () => clearInterval(iv);
  }, []);

  const totalDomainNodes = domains.reduce((s, [, c]) => s + c, 0);
  const retention = alerts.length > 0
    ? Math.round((1 - alerts.reduce((s, a) => s + (a.forget_score || 0), 0) / alerts.length) * 100)
    : 100;

  const FEATURES = [
    { id: 'brain',    icon: '◈', label: 'My Brain',     desc: 'Explore your 3D knowledge graph',     color: '#6366f1', size: 'wide'   },
    { id: 'chat',     icon: '◎', label: 'AI Chat',       desc: 'Ask anything, grounded in your mind', color: '#6366f1', size: 'normal' },
    { id: 'review',   icon: '↺', label: 'Review',        desc: 'Active flashcard recall session',     color: '#6366f1', size: 'normal' },
    { id: 'digest',   icon: '▤', label: 'Digest',        desc: "Today's learning brief",              color: '#6366f1', size: 'normal' },
    { id: 'add',      icon: '＋', label: 'Add Knowledge', desc: 'URL · Text · PDF · Voice',            color: '#6366f1', size: 'normal' },
    { id: 'gaps',     icon: '◇', label: 'Gap Analysis',  desc: 'Discover skill blind spots',          color: '#6366f1', size: 'normal' },
    { id: 'timeline', icon: '▦', label: 'Timeline',      desc: 'See your daily knowledge growth',     color: '#6366f1', size: 'normal' },
    { id: 'insights', icon: '◑', label: 'Insights',      desc: 'PageRank · clusters · memory stats',  color: '#6366f1', size: 'normal' },
    { id: 'report',   icon: '▣', label: 'Weekly Report', desc: 'Download your progress PDF',          color: '#6366f1', size: 'normal' },
    { id: 'privacy',  icon: '◉', label: 'Privacy',       desc: 'Manage, export & delete your data',   color: '#6366f1', size: 'normal' },
  ];

  return (
    <div className="db3-shell">
      <NeuralBg />

      {/* NAV */}
      <motion.nav className="db3-nav"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}>
        <div className="db3-nav__brand">
          <span className="db3-nav__orb" />
          <span className="db3-nav__name">ENGRAM</span>
          <span className="db3-nav__tag">AI Memory OS</span>
        </div>
        <div className="db3-nav__center">
          <span className="db3-nav__mono">{time}</span>
        </div>
        <div className="db3-nav__right">
          <PipelineChip status={pipeline.status} />
          <motion.button
            className={`db3-run-now ${pipeline.status === 'running' || triggering ? 'db3-run-now--running' : ''} ${triggerDone ? 'db3-run-now--done' : ''}`}
            onClick={handleRunNow}
            disabled={pipeline.status === 'running' || triggering}
            whileTap={{ scale: 0.95 }}
            data-cursor="hover"
            title="Process queued captures now — don't wait until midnight"
          >
            {triggerDone ? '✓ Done' : pipeline.status === 'running' || triggering ? '⟳ Running…' : '▶ Process Now'}
          </motion.button>
          <div className={`db3-chip ${wsConnected ? '' : 'db3-chip--dim'}`}
            style={{ '--chip-color': wsConnected ? '#34d399' : '#94a3b8' }}>
            <span className={`db3-chip__dot ${wsConnected ? 'db3-chip__dot--pulse' : ''}`}
              style={{ background: wsConnected ? '#34d399' : '#94a3b8' }} />
            {wsConnected ? 'Live' : 'Offline'}
          </div>
          <ThemeToggle />
        </div>
      </motion.nav>

      {/* BODY */}
      <div className="db3-body">

        {/* LEFT */}
        <div className="db3-left">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
            <ClockDisplay time={time} date={date} seconds={seconds} />
          </motion.div>

          {ready && (
            <div className="db3-stats-grid">
              <StatCard label="Concepts" value={<Counter value={stats?.node_count  ?? 0} />} color="#818cf8" icon="◈" delay={0.2} />
              <StatCard label="Edges"    value={<Counter value={stats?.edge_count  ?? 0} />} color="#38bdf8" icon="⟳" delay={0.27} />
              <StatCard label="Domains"  value={<Counter value={Object.keys(stats?.domains || {}).length} />} color="#fbbf24" icon="◉" delay={0.34} />
              <StatCard label="Fading"   value={alerts.length} color="#f87171" icon="⚠" warn={alerts.length > 0} delay={0.41} />
            </div>
          )}

          {ready && (
            <motion.div className="db3-retention-card"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}>
              <div className="db3-retention-card__left">
                <div className="db3-retention-card__label">Memory Retention</div>
                <div className="db3-retention-card__value"
                  style={{ color: retention > 80 ? '#34d399' : retention > 60 ? '#fbbf24' : '#f87171' }}>
                  {retention}%
                </div>
                <div className="db3-retention-card__sub">
                  {alerts.length} concept{alerts.length !== 1 ? 's' : ''} fading
                </div>
              </div>
              <RingProgress pct={retention}
                color={retention > 80 ? '#34d399' : retention > 60 ? '#fbbf24' : '#f87171'} />
            </motion.div>
          )}

          {domains.length > 0 && (
            <motion.div className="db3-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.5 }}>
              <div className="db3-section-label">Knowledge Domains</div>
              {domains.map(([name, count], i) => (
                <DomainBar key={name} name={name} count={count} total={totalDomainNodes} delay={0.6 + i * 0.05} />
              ))}
            </motion.div>
          )}

          {alerts.length > 0 && (
            <motion.div className="db3-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.5 }}>
              <div className="db3-section-label">Fading Memory</div>
              {alerts.slice(0, 5).map((a, i) => (
                <FadingRow key={a.concept_id || i} alert={a} idx={i} />
              ))}
            </motion.div>
          )}
        </div>

        {/* RIGHT */}
        <div className="db3-main">
          <motion.div className="db3-hero"
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <div className="db3-hero__eyebrow">AI Memory OS · Knowledge Engine</div>
            <h1 className="db3-hero__title">
              <span className="db3-hero__t1">EN</span>
              <span className="db3-hero__t2">GRAM</span>
            </h1>
            <p className="db3-hero__sub">
              Everything you've read, watched, and learned — organised, recalled, and ready.
            </p>
            <div className="db3-hero__glow" />
          </motion.div>

          <div className="db3-tile-grid">
            {FEATURES.map((f, i) => (
              <FeatureTile key={f.id} {...f} onClick={onNavigate} delay={0.25 + i * 0.06} />
            ))}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <motion.div className="db3-footer"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}>
        <span>ENGRAM · B.Tech Capstone 2025–26 · KIT's College of Engineering</span>
        <span className="db3-footer__right">
          {ready && stats ? `${stats.node_count ?? 0} nodes · ${stats.edge_count ?? 0} edges` : '—'}
        </span>
      </motion.div>
    </div>
  );
}
