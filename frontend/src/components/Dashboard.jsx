import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { graphAPI, pipelineAPI, memoryAPI } from '../api/client';

// ── Domain colours ────────────────────────────────────────────────────────────
const DOMAIN_COLORS = {
  'Machine Learning': '#818cf8',
  'Web Development':  '#38bdf8',
  'System Design':    '#fbbf24',
  'DSA':              '#34d399',
  'DevOps':           '#f87171',
  'Data Science':     '#c084fc',
  'General':          '#94a3b8',
};
function domainColor(d) { return DOMAIN_COLORS[d] || '#94a3b8'; }

// ── Live clock ────────────────────────────────────────────────────────────────
function useClock() {
  const [t, setT] = useState({ time: '', date: '' });
  useEffect(() => {
    const tick = () => setT({
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      date: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    });
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ value, duration = 1.2 }) {
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

// ── Particle canvas background ────────────────────────────────────────────────
function ParticleBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width  = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);

    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.4 + 0.1,
    }));

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(129,140,248,${p.alpha})`;
        ctx.fill();
      });
      // draw faint lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(129,140,248,${0.06 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);
  return <canvas ref={canvasRef} className="db2-particle-canvas" />;
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon, label, desc, color, onClick, delay = 0 }) {
  return (
    <motion.button
      className="db2-feature-card"
      onClick={onClick}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -6, scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      data-cursor="hover"
      style={{ '--card-color': color }}
    >
      <div className="db2-feature-card__glow" style={{ background: color }} />
      <div className="db2-feature-card__icon">{icon}</div>
      <div className="db2-feature-card__label">{label}</div>
      <div className="db2-feature-card__desc">{desc}</div>
      <div className="db2-feature-card__arrow">→</div>
    </motion.button>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ onNavigate, wsConnected }) {
  const { time, date } = useClock();
  const [stats,    setStats]   = useState(null);
  const [alerts,   setAlerts]  = useState([]);
  const [pipeline, setPipeline] = useState({ status: 'idle' });
  const [domains,  setDomains]  = useState([]);
  const [ready,    setReady]    = useState(false);

  useEffect(() => {
    Promise.allSettled([
      graphAPI.getStats(),
      memoryAPI.getAlerts(0.6),
      pipelineAPI.getStatus(),
    ]).then(([s, a, p]) => {
      if (s.status === 'fulfilled') {
        setStats(s.value.data);
        setDomains(
          Object.entries(s.value.data?.domains || {})
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
        );
      }
      if (a.status === 'fulfilled') setAlerts(a.value.data?.alerts || []);
      if (p.status === 'fulfilled') setPipeline(p.value.data);
      setReady(true);
    });
    const iv = setInterval(() =>
      pipelineAPI.getStatus().then(r => setPipeline(r.data)).catch(() => {}), 30000);
    return () => clearInterval(iv);
  }, []);

  const retention = alerts.length > 0
    ? Math.round((1 - alerts.reduce((s, a) => s + (a.forget_score || 0), 0) / alerts.length) * 100)
    : 100;

  const FEATURES = [
    { id: 'brain',   icon: '◈', label: 'My Brain',     desc: 'Explore your 3D knowledge graph',  color: '#818cf8' },
    { id: 'chat',    icon: '◎', label: 'Chat',          desc: 'Ask your Second Brain anything',    color: '#38bdf8' },
    { id: 'digest',  icon: '▤', label: 'Digest',        desc: 'Today\'s learning summary',         color: '#34d399' },
    { id: 'add',     icon: '＋', label: 'Add Knowledge', desc: 'Ingest URLs, text, PDF or voice',   color: '#fbbf24' },
    { id: 'gaps',    icon: '◇', label: 'Gap Analysis',  desc: 'Discover missing skills',           color: '#f87171' },
    { id: 'report',  icon: '▣', label: 'Weekly Report', desc: 'Download your progress PDF',        color: '#c084fc' },
    { id: 'privacy', icon: '◉', label: 'Privacy',       desc: 'Manage & delete your data',         color: '#fb923c' },
  ];

  return (
    <div className="db2-shell">
      <ParticleBg />

      {/* ── TOP STATUS BAR ── */}
      <motion.div
        className="db2-statusbar"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="db2-statusbar__left">
          <span className="db2-brand-dot" />
          <span className="db2-brand-name">PSB®</span>
        </div>
        <div className="db2-statusbar__indicators">
          <span className={`db2-indicator ${pipeline.status === 'running' ? 'db2-indicator--green' : pipeline.status === 'failed' ? 'db2-indicator--red' : ''}`}>
            <span className="db2-indicator__dot" />
            Pipeline {pipeline.status === 'running' ? 'Running' : pipeline.status === 'failed' ? 'Failed' : 'Idle'}
          </span>
          <span className={`db2-indicator ${wsConnected ? 'db2-indicator--green' : 'db2-indicator--dim'}`}>
            <span className="db2-indicator__dot" />
            {wsConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </motion.div>

      {/* ── HERO CENTER ── */}
      <div className="db2-center">

        {/* Clock */}
        <motion.div
          className="db2-clock-block"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
        >
          <div className="db2-clock">{time}</div>
          <div className="db2-date">{date}</div>
        </motion.div>

        {/* Title */}
        <motion.div
          className="db2-title-block"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="db2-eyebrow">AI Memory OS</div>
          <h1 className="db2-headline">
            <span className="db2-headline__line">PASSIVE</span>
            <span className="db2-headline__line db2-headline__line--accent">SECOND</span>
            <span className="db2-headline__line">BRAIN</span>
          </h1>
        </motion.div>

        {/* Stats row */}
        {ready && (
          <motion.div
            className="db2-stats-row"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            {[
              { label: 'Concepts',   value: stats?.node_count  ?? 0 },
              { label: 'Edges',      value: stats?.edge_count  ?? 0 },
              { label: 'Domains',    value: Object.keys(stats?.domains || {}).length },
              { label: 'Fading',     value: alerts.length,    warn: alerts.length > 0 },
              { label: 'Retention',  value: `${retention}%`,  raw: true },
            ].map((s, i) => (
              <div className="db2-stat-pill" key={s.label}>
                <div className={`db2-stat-pill__value ${s.warn ? 'db2-stat-pill__value--warn' : ''}`}>
                  {s.raw ? s.value : <Counter value={s.value} duration={0.8 + i * 0.1} />}
                </div>
                <div className="db2-stat-pill__label">{s.label}</div>
              </div>
            ))}
          </motion.div>
        )}

        {/* Domain strip */}
        {domains.length > 0 && (
          <motion.div
            className="db2-domain-strip"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.6 }}
          >
            {domains.map(([d, count]) => (
              <div key={d} className="db2-domain-chip">
                <span className="db2-domain-chip__dot" style={{ background: domainColor(d) }} />
                <span className="db2-domain-chip__name">{d}</span>
                <span className="db2-domain-chip__count">{count}</span>
              </div>
            ))}
          </motion.div>
        )}

        {/* Feature grid */}
        <div className="db2-feature-grid">
          {FEATURES.map((f, i) => (
            <FeatureCard
              key={f.id}
              icon={f.icon}
              label={f.label}
              desc={f.desc}
              color={f.color}
              delay={0.35 + i * 0.06}
              onClick={() => onNavigate(f.id)}
            />
          ))}
        </div>

        {/* Footer */}
        <motion.div
          className="db2-footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.5 }}
        >
          <span>Passive Second Brain · B.Tech Capstone 2025–26</span>
          <span>Prasad · KIT's College of Engineering Kolhapur</span>
        </motion.div>
      </div>
    </div>
  );
}
