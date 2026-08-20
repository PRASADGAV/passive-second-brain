import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useMotionValue, useSpring, AnimatePresence } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';
import BrainXRay from './BrainXRay';

// ─────────────────────────────────────────────────────────────────────────────
// Colour palette — monochrome + single indigo accent. No rainbows.
// ─────────────────────────────────────────────────────────────────────────────
// Dark:  bg #060609, surface rgba(255,255,255,.04), ink #fff, accent #6366f1
// Light: bg #f4f4f6, surface rgba(0,0,0,.04),       ink #0a0a10, accent #6366f1
// ─────────────────────────────────────────────────────────────────────────────

// ── Static grain overlay (painted once) ──────────────────────────────────────
function GrainOverlay() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(512, 512);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 22 | 0;
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 20;
    }
    ctx.putImageData(img, 0, 0);
  }, []);
  return <canvas ref={ref} className="lp2-grain lp2-grain--static" />;
}

// ── Theme toggle ──────────────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <motion.button className="engram-theme-btn" onClick={toggle}
      whileTap={{ scale: 0.9 }} title="Toggle theme" data-cursor="hover">
      <motion.span key={theme} className="engram-theme-btn__icon"
        initial={{ opacity: 0, rotate: -30, scale: 0.7 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        transition={{ duration: 0.25 }}>
        {theme === 'dark' ? '☀' : '☾'}
      </motion.span>
    </motion.button>
  );
}

// ── Magnetic CTA button ───────────────────────────────────────────────────────
function MagneticBtn({ children, className, onClick, strength = 0.3 }) {
  const ref = useRef(null);
  const x = useMotionValue(0); const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 160, damping: 18 });
  const sy = useSpring(y, { stiffness: 160, damping: 18 });
  const onMove = useCallback(e => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - r.left - r.width / 2) * strength);
    y.set((e.clientY - r.top - r.height / 2) * strength);
  }, [x, y, strength]);
  const onLeave = useCallback(() => { x.set(0); y.set(0); }, [x, y]);
  return (
    <motion.button ref={ref} className={className}
      style={{ x: sx, y: sy }}
      onMouseMove={onMove} onMouseLeave={onLeave}
      onClick={onClick} whileTap={{ scale: 0.96 }} data-cursor="hover">
      {children}
    </motion.button>
  );
}

// ── Scramble text ─────────────────────────────────────────────────────────────
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function useScramble(target, delay = 0) {
  const [text, setText] = useState(target);
  const iter = useRef(0);
  useEffect(() => {
    iter.current = 0;
    const tid = setTimeout(() => {
      const id = setInterval(() => {
        setText(target.split('').map((c, i) =>
          i < iter.current ? target[i]
          : c === ' ' ? ' '
          : CHARS[Math.floor(Math.random() * CHARS.length)]
        ).join(''));
        if (iter.current >= target.length) clearInterval(id);
        iter.current += 0.5;
      }, 28);
      return () => clearInterval(id);
    }, delay);
    return () => clearTimeout(tid);
  }, [target, delay]);
  return text;
}

// ── Marquee ───────────────────────────────────────────────────────────────────
const MARQUEE_ITEMS = [
  'KNOWLEDGE GRAPH','·','SPACED REPETITION','·','RAG CHAT','·',
  'GAP ANALYSIS','·','DAILY DIGEST','·','PASSIVE CAPTURE','·',
  'NEO4J','·','LLAMA 3.3','·','CHROMADB','·','SM-2','·',
];
function Marquee() {
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="lp3-marquee" aria-hidden>
      <motion.div className="lp3-marquee__track"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}>
        {items.map((t, i) => (
          <span key={i} className={`lp3-marquee__item ${t === '·' ? 'lp3-marquee__dot' : ''}`}>{t}</span>
        ))}
      </motion.div>
    </div>
  );
}

// ── X-Ray Cognitive Hero — the centrepiece ────────────────────────────────────
// Surface: abstract neural mesh SVG  |  Depth: domain cluster diagram SVG
// Mouse moves a soft-edged lens cut through the surface revealing the depth.
// All position updates go direct to CSS custom properties — no React state.

const XRAY_REGIONS = [
  { id: 'ml',     xRange: [0.15, 0.5],  yRange: [0.1,  0.45], label: 'ML · CONCEPT CLUSTER' },
  { id: 'web',    xRange: [0.5,  0.85], yRange: [0.1,  0.45], label: 'WEB · KNOWLEDGE NODES' },
  { id: 'sys',    xRange: [0.1,  0.45], yRange: [0.45, 0.85], label: 'SYSTEMS · GRAPH EDGES' },
  { id: 'data',   xRange: [0.45, 0.9],  yRange: [0.45, 0.85], label: 'DATA · MEMORY TRACES' },
];

function XRayHero() {
  const containerRef = useRef(null);
  const rimRef       = useRef(null);
  const labelRef     = useRef(null);
  const debounceRef  = useRef(null);
  const [activeRegion, setActiveRegion] = useState(null);
  const [entered,      setEntered]      = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Set initial position off-screen so lens doesn't show until hover
    el.style.setProperty('--x', '-200px');
    el.style.setProperty('--y', '-200px');

    let raf = null;
    const handleMove = e => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--x', `${x}px`);
        el.style.setProperty('--y', `${y}px`);
        if (rimRef.current) {
          rimRef.current.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
        }
        // Debounce region detection — don't do it every frame
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const nx = x / rect.width;
          const ny = y / rect.height;
          const region = XRAY_REGIONS.find(r =>
            nx >= r.xRange[0] && nx <= r.xRange[1] &&
            ny >= r.yRange[0] && ny <= r.yRange[1]
          ) || null;
          setActiveRegion(region?.label || null);
        }, 120);
        raf = null;
      });
    };
    const handleEnter = () => setEntered(true);
    const handleLeave = () => {
      setEntered(false);
      setActiveRegion(null);
      el.style.setProperty('--x', '-200px');
      el.style.setProperty('--y', '-200px');
    };
    el.addEventListener('mousemove',  handleMove);
    el.addEventListener('mouseenter', handleEnter);
    el.addEventListener('mouseleave', handleLeave);
    return () => {
      el.removeEventListener('mousemove',  handleMove);
      el.removeEventListener('mouseenter', handleEnter);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, []);

  return (
    <div ref={containerRef} className="xray-hero" aria-label="Interactive knowledge map">
      {/* ── Depth layer — domain cluster diagram ── */}
      <div className="xray-hero__depth">
        <svg viewBox="0 0 480 380" xmlns="http://www.w3.org/2000/svg"
          className="xray-hero__depth-svg" aria-hidden>
          {/* ML cluster — top left */}
          <g opacity=".8">
            <circle cx="100" cy="90"  r="22" fill="none" stroke="#6366f1" strokeWidth="1.2"/>
            <circle cx="160" cy="70"  r="14" fill="none" stroke="#6366f1" strokeWidth="1"/>
            <circle cx="140" cy="140" r="18" fill="none" stroke="#6366f1" strokeWidth="1"/>
            <line x1="100" y1="90"  x2="160" y2="70"  stroke="#6366f1" strokeWidth=".6" opacity=".5"/>
            <line x1="100" y1="90"  x2="140" y2="140" stroke="#6366f1" strokeWidth=".6" opacity=".5"/>
            <line x1="160" y1="70"  x2="140" y2="140" stroke="#6366f1" strokeWidth=".4" opacity=".4"/>
            <text x="100" y="93"  textAnchor="middle" fill="#6366f1" fontSize="7" fontFamily="JetBrains Mono">ML</text>
            <text x="160" y="73"  textAnchor="middle" fill="#6366f1" fontSize="6" fontFamily="JetBrains Mono">NLP</text>
            <text x="140" y="143" textAnchor="middle" fill="#6366f1" fontSize="6" fontFamily="JetBrains Mono">CV</text>
          </g>
          {/* Web cluster — top right */}
          <g opacity=".8">
            <circle cx="340" cy="80"  r="20" fill="none" stroke="#a5b4fc" strokeWidth="1.2"/>
            <circle cx="395" cy="110" r="15" fill="none" stroke="#a5b4fc" strokeWidth="1"/>
            <circle cx="310" cy="130" r="17" fill="none" stroke="#a5b4fc" strokeWidth="1"/>
            <line x1="340" y1="80"  x2="395" y2="110" stroke="#a5b4fc" strokeWidth=".6" opacity=".5"/>
            <line x1="340" y1="80"  x2="310" y2="130" stroke="#a5b4fc" strokeWidth=".6" opacity=".5"/>
            <text x="340" y="83"  textAnchor="middle" fill="#a5b4fc" fontSize="7" fontFamily="JetBrains Mono">React</text>
            <text x="395" y="113" textAnchor="middle" fill="#a5b4fc" fontSize="6" fontFamily="JetBrains Mono">API</text>
            <text x="310" y="133" textAnchor="middle" fill="#a5b4fc" fontSize="6" fontFamily="JetBrains Mono">DB</text>
          </g>
          {/* Systems cluster — bottom left */}
          <g opacity=".8">
            <circle cx="90"  cy="270" r="20" fill="none" stroke="#818cf8" strokeWidth="1.2"/>
            <circle cx="150" cy="300" r="14" fill="none" stroke="#818cf8" strokeWidth="1"/>
            <circle cx="70"  cy="320" r="12" fill="none" stroke="#818cf8" strokeWidth="1"/>
            <line x1="90"  y1="270" x2="150" y2="300" stroke="#818cf8" strokeWidth=".6" opacity=".5"/>
            <line x1="90"  y1="270" x2="70"  y2="320" stroke="#818cf8" strokeWidth=".6" opacity=".5"/>
            <text x="90"  y="273" textAnchor="middle" fill="#818cf8" fontSize="6" fontFamily="JetBrains Mono">OS</text>
            <text x="150" y="303" textAnchor="middle" fill="#818cf8" fontSize="6" fontFamily="JetBrains Mono">Net</text>
            <text x="70"  y="323" textAnchor="middle" fill="#818cf8" fontSize="6" fontFamily="JetBrains Mono">DSA</text>
          </g>
          {/* Data cluster — bottom right */}
          <g opacity=".8">
            <circle cx="360" cy="280" r="22" fill="none" stroke="#c7d2fe" strokeWidth="1.2"/>
            <circle cx="420" cy="260" r="14" fill="none" stroke="#c7d2fe" strokeWidth="1"/>
            <circle cx="390" cy="330" r="16" fill="none" stroke="#c7d2fe" strokeWidth="1"/>
            <line x1="360" y1="280" x2="420" y2="260" stroke="#c7d2fe" strokeWidth=".6" opacity=".5"/>
            <line x1="360" y1="280" x2="390" y2="330" stroke="#c7d2fe" strokeWidth=".6" opacity=".5"/>
            <text x="360" y="283" textAnchor="middle" fill="#c7d2fe" fontSize="6" fontFamily="JetBrains Mono">Stats</text>
            <text x="420" y="263" textAnchor="middle" fill="#c7d2fe" fontSize="6" fontFamily="JetBrains Mono">SQL</text>
            <text x="390" y="333" textAnchor="middle" fill="#c7d2fe" fontSize="6" fontFamily="JetBrains Mono">ETL</text>
          </g>
          {/* Cross-cluster edges */}
          <line x1="140" y1="140" x2="310" y2="130" stroke="#4f46e5" strokeWidth=".4" strokeDasharray="4 4" opacity=".35"/>
          <line x1="150" y1="300" x2="360" y2="280" stroke="#4f46e5" strokeWidth=".4" strokeDasharray="4 4" opacity=".35"/>
          <line x1="100" y1="90"  x2="90"  y2="270" stroke="#4f46e5" strokeWidth=".4" strokeDasharray="4 4" opacity=".3"/>
          <line x1="340" y1="80"  x2="360" y2="280" stroke="#4f46e5" strokeWidth=".4" strokeDasharray="4 4" opacity=".3"/>
          {/* Central memory node */}
          <circle cx="240" cy="190" r="28" fill="none" stroke="#6366f1" strokeWidth="1.5"/>
          <circle cx="240" cy="190" r="8"  fill="#6366f1" opacity=".3"/>
          <text x="240" y="193" textAnchor="middle" fill="#6366f1" fontSize="8" fontFamily="JetBrains Mono" fontWeight="600">MEM</text>
          <line x1="140" y1="140" x2="212" y2="175" stroke="#6366f1" strokeWidth=".6" opacity=".4"/>
          <line x1="310" y1="130" x2="268" y2="175" stroke="#6366f1" strokeWidth=".6" opacity=".4"/>
          <line x1="150" y1="300" x2="215" y2="210" stroke="#6366f1" strokeWidth=".6" opacity=".4"/>
          <line x1="360" y1="280" x2="268" y2="210" stroke="#6366f1" strokeWidth=".6" opacity=".4"/>
        </svg>
      </div>

      {/* ── Surface layer — neural mesh, masked by lens ── */}
      <div className="xray-hero__surface">
        <svg viewBox="0 0 480 380" xmlns="http://www.w3.org/2000/svg"
          className="xray-hero__surface-svg" aria-hidden>
          {/* Background fill to hide depth layer */}
          <rect width="480" height="380" fill="#060609"/>
          {/* Neural mesh lines */}
          {[
            [20,20,460,80],[460,80,400,200],[400,200,460,360],[460,360,20,340],
            [20,340,80,200],[80,200,20,20],[240,10,460,200],[240,10,20,200],
            [460,200,240,370],[20,200,240,370],[120,90,360,90],[360,90,380,280],
            [380,280,120,280],[120,280,100,90],[200,50,280,50],[280,50,420,180],
            [420,180,360,320],[360,320,120,320],[120,320,60,180],[60,180,200,50],
          ].map(([x1,y1,x2,y2],i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(99,102,241,0.12)" strokeWidth=".8"/>
          ))}
          {/* Nodes */}
          {[[240,190],[120,90],[360,90],[380,280],[100,280],[200,50],[280,50],
            [420,180],[360,320],[60,180],[80,200],[400,200]].map(([cx,cy],i) => (
            <circle key={i} cx={cx} cy={cy} r={i===0?6:3.5}
              fill={i===0?'#6366f1':'rgba(99,102,241,0.5)'}/>
          ))}
          {/* Foregroud label */}
          <text x="240" y="340" textAnchor="middle"
            fill="rgba(255,255,255,0.12)" fontSize="9" fontFamily="JetBrains Mono"
            letterSpacing="4">MOVE CURSOR TO EXPLORE</text>
        </svg>
      </div>

      {/* ── Lens rim — follows cursor ── */}
      <div ref={rimRef} className={`xray-hero__rim ${entered ? 'xray-hero__rim--visible' : ''}`} />

      {/* ── Region label ── */}
      <AnimatePresence>
        {activeRegion && (
          <motion.div className="xray-hero__label"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {activeRegion}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Stat counter ──────────────────────────────────────────────────────────────
function Ticker({ to, label, delay }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const tid = setTimeout(() => {
      let cur = 0; const step = to / 48;
      const id = setInterval(() => {
        cur += step;
        if (cur >= to) { setN(to); clearInterval(id); }
        else setN(Math.floor(cur));
      }, 1000 / 60);
      return () => clearInterval(id);
    }, delay * 1000);
    return () => clearTimeout(tid);
  }, [to, delay]);
  return (
    <motion.div className="lp3-ticker"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55 }}>
      <span className="lp3-ticker__val">{n}+</span>
      <span className="lp3-ticker__label">{label}</span>
    </motion.div>
  );
}

// ── Feature row ───────────────────────────────────────────────────────────────
function FeatureRow({ num, title, body, delay }) {
  return (
    <motion.div className="lp3-feat-row"
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
      <span className="lp3-feat-row__num">{num}</span>
      <div className="lp3-feat-row__body">
        <div className="lp3-feat-row__title">{title}</div>
        <div className="lp3-feat-row__text">{body}</div>
      </div>
    </motion.div>
  );
}

// ── MAIN LANDING PAGE ─────────────────────────────────────────────────────────
export default function LandingPage({ onEnter }) {
  const e1 = useScramble('EN',   300);
  const e2 = useScramble('GRAM', 700);

  const FEATURES = [
    { num: '01', title: 'Passive Capture',     body: 'Reads URLs, videos and PDFs as you browse. Zero manual effort.' },
    { num: '02', title: 'Knowledge Graph',     body: 'Extracts concepts and 6-typed relationships via Llama 3.3 70B.' },
    { num: '03', title: 'SM-2 Memory',         body: 'Ebbinghaus forgetting curve per concept. Surface before it fades.' },
    { num: '04', title: 'Hybrid RAG Chat',     body: 'Ask anything. Answers grounded in your graph, not the internet.' },
    { num: '05', title: 'Gap Analysis',        body: 'Paste a job description. Get a precise map of missing skills.' },
    { num: '06', title: 'Temporal Spiral',     body: 'Visualise when you learned every concept in a 3D helix.' },
  ];

  return (
    <div className="lp3-shell">
      <GrainOverlay />

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <motion.nav className="lp3-nav"
        initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55 }}>
        <div className="lp3-nav__brand">
          <span className="lp3-nav__dot" />
          <span className="lp3-nav__name">ENGRAM</span>
        </div>
        <div className="lp3-nav__center">
          <span className="lp3-nav__tag">AI Memory OS</span>
          <span className="lp3-nav__sep" />
          <span className="lp3-nav__tag">B.Tech Capstone · 2026</span>
        </div>
        <div className="lp3-nav__right">
          <ThemeToggle />
        </div>
      </motion.nav>

      {/* ── HERO SPLIT ──────────────────────────────────────────────── */}
      <main className="lp3-main">

        {/* LEFT — copy + CTA */}
        <div className="lp3-left">
          <motion.div className="lp3-eyebrow"
            initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.18, duration: 0.55 }}>
            <span className="lp3-eyebrow__pulse" />
            Knowledge Engineering System
          </motion.div>

          <h1 className="lp3-headline">
            <span className="lp3-hl-wrap">
              <motion.span className="lp3-hl lp3-hl--1"
                initial={{ y: '105%' }} animate={{ y: '0%' }}
                transition={{ delay: 0.26, duration: 0.75, ease: [0.16,1,0.3,1] }}>
                {e1}
              </motion.span>
            </span>
            <span className="lp3-hl-wrap">
              <motion.span className="lp3-hl lp3-hl--2"
                initial={{ y: '105%' }} animate={{ y: '0%' }}
                transition={{ delay: 0.38, duration: 0.75, ease: [0.16,1,0.3,1] }}>
                {e2}
              </motion.span>
            </span>
          </h1>

          <motion.p className="lp3-desc"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}>
            Your second brain that builds itself. Capture passively,
            recall intelligently, grow continuously.
          </motion.p>

          <motion.div className="lp3-tickers"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.72, duration: 0.5 }}>
            <Ticker to={228} label="Tests"        delay={0.76} />
            <div className="lp3-ticker-sep" />
            <Ticker to={6}   label="Rel. Types"   delay={0.82} />
            <div className="lp3-ticker-sep" />
            <Ticker to={10}  label="Features"     delay={0.88} />
          </motion.div>

          <motion.div className="lp3-cta"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.92, duration: 0.6, ease: [0.16,1,0.3,1] }}>
            <MagneticBtn className="lp3-btn lp3-btn--primary" onClick={onEnter} strength={0.35}>
              <span>Enter Workspace</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="lp3-btn__shimmer" />
            </MagneticBtn>
            <MagneticBtn className="lp3-btn lp3-btn--ghost" strength={0.2}>
              <span>View Architecture</span>
            </MagneticBtn>
          </motion.div>

          <motion.div className="lp3-pills"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 1.05, duration: 0.5 }}>
            {['Neo4j · Graph DB', 'Llama 3.3 · LLM', 'ChromaDB · RAG', 'SM-2 · Memory'].map((p, i) => (
              <motion.span key={p} className="lp3-pill"
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.08 + i * 0.06 }}>
                {p}
              </motion.span>
            ))}
          </motion.div>
        </div>

        {/* RIGHT — Brain X-Ray + feature list */}
        <div className="lp3-right">
          <motion.div className="brain-xray-wrap"
            initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.9, ease: [0.16,1,0.3,1] }}>
            <BrainXRay />
          </motion.div>

          <div className="lp3-feat-list">
            {FEATURES.map((f, i) => (
              <FeatureRow key={f.num} {...f} delay={0.5 + i * 0.07} />
            ))}
          </div>
        </div>
      </main>

      <Marquee />

      <motion.footer className="lp3-footer"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 1.1, duration: 0.5 }}>
        <span>Built for architects of thought — KIT's College of Engineering · Prasad · 2025–26</span>
        <span className="lp3-footer__right">01 / 01</span>
      </motion.footer>
    </div>
  );
}
