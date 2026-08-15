import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─────────────────────────────────────────────────────────────────
   The brain is TWO overlapping SVGs, identical viewBox 0 0 500 400.

   LAYER 1 (bottom): dark interior — concept nodes, edges, scan line.
                     Always fully visible.

   LAYER 2 (top):    pink faceted brain surface.
                     Has a CSS clip-path that shows the FULL surface
                     EXCEPT inside the cursor circle.

   Trick: we use TWO clip-path regions —
     - a large rect covering the whole canvas
     - MINUS the cursor circle  (using SVG clipPath with evenodd)
   Because CSS clip-path can't subtract, we do it with an SVG
   <clipPath> + <rect> + <circle> using fill-rule="evenodd".
   ───────────────────────────────────────────────────────────────── */

/* ── Brain outline — proper side-profile anatomical shape ────────── */
/* Traced carefully: wide cortex dome, flat-ish bottom,
   cerebellum bump bottom-right, brainstem nub below it */
const BRAIN = `M 118,170
  C 118,138 130,106 154,82
  C 178,58  212,42  248,40
  C 284,38  318,52  344,74
  C 370,96  382,126 382,158
  C 382,180 374,202 362,220
  C 354,234 344,246 340,260
  C 334,276 334,290 340,304
  C 346,318 354,330 348,344
  C 340,360 322,368 302,368
  C 282,368 264,358 252,344
  C 244,336 238,344 226,350
  C 212,358 196,356 182,346
  C 168,336 160,320 160,304
  C 160,288 168,274 164,258
  C 160,244 148,232 140,216
  C 128,198 118,184 118,170 Z`;

/* Cerebellum */
const CEREB = `M 340,264
  C 350,256 366,254 378,262
  C 390,270 396,284 392,298
  C 388,312 376,320 364,316
  C 352,312 344,300 344,286
  C 344,278 340,270 340,264 Z`;

/* Brainstem */
const STEM = `M 346,342 C 354,350 358,364 352,374
  C 348,382 338,384 330,378
  C 322,372 322,360 328,352 Z`;

/* ── Low-poly faces — covers entire brain surface ────────────────── */
/* Light model: key light top-right. l=1.0=brightest top-right, l=0.55=darkest bottom-left */
const F = [
  /* top crown — bright */
  {p:'192,62  234,44  228,100', l:.96},
  {p:'234,44  272,42  260,98',  l:.98},
  {p:'272,42  310,56  296,102', l:.94},
  {p:'310,56  340,76  324,110', l:.90},
  {p:'340,76  368,100 350,124', l:.86},
  {p:'368,100 382,130 366,148', l:.82},
  /* upper-left */
  {p:'155,84  192,62  200,110', l:.86},
  {p:'138,120 155,84  175,118', l:.82},
  {p:'118,158 138,120 160,148', l:.78},
  /* center top */
  {p:'192,62  228,100 218,128', l:.92},
  {p:'228,100 260,98  250,126', l:.94},
  {p:'260,98  296,102 282,128', l:.92},
  {p:'296,102 324,110 312,136', l:.88},
  {p:'324,110 350,124 338,150', l:.85},
  {p:'350,124 366,148 354,165', l:.82},
  {p:'366,148 382,130 380,160', l:.80},
  /* deep fold — darker V-shapes */
  {p:'200,110 218,128 196,142', l:.74},
  {p:'218,128 250,126 235,152', l:.78},
  {p:'250,126 282,128 268,155', l:.80},
  {p:'282,128 312,136 300,160', l:.78},
  {p:'312,136 338,150 326,174', l:.76},
  {p:'338,150 354,165 344,184', l:.74},
  {p:'354,165 380,160 372,182', l:.72},
  {p:'380,160 382,158 380,182', l:.70},
  /* mid cortex */
  {p:'175,118 196,142 185,168', l:.76},
  {p:'196,142 235,152 222,178', l:.79},
  {p:'235,152 268,155 255,180', l:.81},
  {p:'268,155 300,160 288,185', l:.79},
  {p:'300,160 326,174 315,198', l:.77},
  {p:'326,174 344,184 336,206', l:.75},
  {p:'344,184 372,182 360,204', l:.73},
  {p:'372,182 380,182 376,205', l:.71},
  /* lower cortex */
  {p:'118,158 175,118 148,172', l:.76},
  {p:'160,148 185,168 170,195', l:.74},
  {p:'185,168 222,178 210,205', l:.77},
  {p:'222,178 255,180 244,208', l:.79},
  {p:'255,180 288,185 276,212', l:.77},
  {p:'288,185 315,198 305,222', l:.75},
  {p:'315,198 336,206 326,230', l:.73},
  {p:'336,206 360,204 350,228', l:.71},
  {p:'360,204 376,205 368,226', l:.69},
  /* temporal */
  {p:'148,172 170,195 155,220', l:.73},
  {p:'170,195 210,205 198,232', l:.75},
  {p:'210,205 244,208 232,238', l:.77},
  {p:'244,208 276,212 265,242', l:.75},
  {p:'276,212 305,222 294,248', l:.73},
  {p:'305,222 326,230 316,255', l:.71},
  {p:'326,230 350,228 340,254', l:.69},
  {p:'350,228 368,226 360,248', l:.68},
  /* bottom */
  {p:'155,220 198,232 186,260', l:.71},
  {p:'198,232 232,238 222,268', l:.73},
  {p:'232,238 265,242 255,272', l:.71},
  {p:'265,242 294,248 284,275', l:.69},
  {p:'294,248 316,255 306,280', l:.67},
  {p:'316,255 340,254 330,278', l:.66},
  {p:'340,254 360,248 350,270', l:.65},
  /* very bottom */
  {p:'186,260 222,268 210,295', l:.68},
  {p:'222,268 255,272 244,300', l:.70},
  {p:'255,272 284,275 274,302', l:.68},
  {p:'284,275 306,280 296,306', l:.66},
  {p:'306,280 330,278 320,302', l:.64},
  /* cerebellum */
  {p:'340,264 358,258 364,280', l:.82},
  {p:'358,258 376,265 372,285', l:.79},
  {p:'376,265 392,278 386,296', l:.75},
  {p:'392,278 392,298 378,308', l:.71},
  {p:'378,308 362,314 356,296', l:.69},
  {p:'356,296 346,282 352,266', l:.72},
  {p:'364,280 372,285 366,298', l:.75},
  {p:'372,285 386,296 376,306', l:.72},
];

const fc = l => {
  const r = Math.round(245*l), g = Math.round(105*l), b = Math.round(178*l);
  return `rgb(${r},${Math.min(255,g)},${b})`;
};
const fs = l => `rgba(185,24,90,${0.1 + l * 0.2})`;

/* ── Concept nodes ────────────────────────────────────────────────── */
const CONCEPTS = [
  {id:'llm',   x:185, y:108, label:'LLM',          domain:'ML',  col:'#818cf8'},
  {id:'attn',  x:238, y:92,  label:'Attention',    domain:'ML',  col:'#818cf8'},
  {id:'tf',    x:290, y:98,  label:'Transformers', domain:'ML',  col:'#818cf8'},
  {id:'vec',   x:338, y:114, label:'Vectors',      domain:'ML',  col:'#818cf8'},
  {id:'sm2',   x:162, y:185, label:'SM-2',         domain:'Mem', col:'#34d399'},
  {id:'rag',   x:215, y:170, label:'RAG',          domain:'ML',  col:'#818cf8'},
  {id:'neo',   x:262, y:164, label:'Neo4j',        domain:'DB',  col:'#f472b6'},
  {id:'chroma',x:310, y:168, label:'ChromaDB',     domain:'DB',  col:'#f472b6'},
  {id:'graph', x:352, y:178, label:'Graph',        domain:'DB',  col:'#f472b6'},
  {id:'dsa',   x:175, y:252, label:'DSA',          domain:'CS',  col:'#fbbf24'},
  {id:'api',   x:238, y:244, label:'API Design',   domain:'Web', col:'#38bdf8'},
  {id:'py',    x:298, y:248, label:'Python',       domain:'Dev', col:'#38bdf8'},
  {id:'cap',   x:346, y:238, label:'CAP Theorem',  domain:'Sys', col:'#fb923c'},
];
const EDGES=[
  ['llm','attn'],['attn','tf'],['tf','vec'],
  ['sm2','rag'],['rag','neo'],['neo','chroma'],
  ['chroma','graph'],['attn','rag'],['vec','graph'],
  ['dsa','api'],['api','py'],['py','cap'],['neo','graph'],
];

/* ════════════════════════════════════════════════════════════════ */
export default function BrainXRay2D() {
  const wrapRef = useRef(null);
  const svgRef  = useRef(null);   // the clipPath <circle> element
  const rimRef  = useRef(null);   // the rim div
  const raw     = useRef({x:-999,y:-999});
  const rafId   = useRef(null);
  const [inside, setInside] = useState(false);
  const [near,   setNear]   = useState(null);

  /* rAF loop — moves the clipPath circle + rim directly in the DOM, zero React re-render */
  useEffect(() => {
    const tick = () => {
      const {x, y} = raw.current;
      if (svgRef.current) {
        svgRef.current.setAttribute('cx', x);
        svgRef.current.setAttribute('cy', y);
      }
      if (rimRef.current) {
        rimRef.current.style.left = x + 'px';
        rimRef.current.style.top  = y + 'px';
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  /* nearest concept — only on mouse move with debounce */
  const nearRef = useRef(null);
  const onMove = useCallback(e => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    raw.current = {x, y};

    /* nearest concept in SVG space */
    const sx = 500 / rect.width;
    const sy = 400 / rect.height;
    const svgX = x * sx, svgY = y * sy;
    let best = null, bd = 48;
    CONCEPTS.forEach(c => {
      const d = Math.hypot(c.x - svgX, c.y - svgY);
      if (d < bd) { best = c; bd = d; }
    });
    if (best !== nearRef.current) {
      nearRef.current = best;
      setNear(best);
    }
  }, []);

  const onEnter = () => setInside(true);
  const onLeave = () => {
    setInside(false);
    setNear(null);
    nearRef.current = null;
    raw.current = {x:-999, y:-999};
  };

  return (
    <div ref={wrapRef} className="brain2d"
      onMouseMove={onMove} onMouseEnter={onEnter} onMouseLeave={onLeave}>

      {/* ── LAYER 1: dark interior — always visible ── */}
      <svg viewBox="0 0 500 400" className="brain2d__svg brain2d__svg--depth">
        <defs>
          <clipPath id="bc3">
            <path d={BRAIN} fillRule="nonzero"/>
            <path d={CEREB} fillRule="nonzero"/>
          </clipPath>
          <filter id="ng3" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="sg3" x="-500%" y="0" width="1100%" height="100%">
            <feGaussianBlur stdDeviation="3.5 0" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Brain shell */}
        <path d={BRAIN} fill="#05050e" stroke="rgba(99,102,241,.22)" strokeWidth="1.2"/>
        <path d={CEREB} fill="#05050e" stroke="rgba(99,102,241,.16)" strokeWidth="1"/>
        <path d={STEM}  fill="#05050e" stroke="rgba(99,102,241,.12)" strokeWidth=".8"/>
        <g clipPath="url(#bc3)">
          {/* grid */}
          {Array.from({length:9},(_,i)=>(
            <line key={`h${i}`} x1="118" y1={80+i*26} x2="395" y2={80+i*26}
              stroke="rgba(99,102,241,.04)" strokeWidth=".5"/>
          ))}
          {/* edges */}
          {EDGES.map(([a,b],i)=>{
            const na=CONCEPTS.find(c=>c.id===a), nb=CONCEPTS.find(c=>c.id===b);
            return na&&nb ? <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke="rgba(99,102,241,.3)" strokeWidth=".8" strokeDasharray="3 5"/> : null;
          })}
          {/* nodes */}
          {CONCEPTS.map(c=>(
            <g key={c.id} filter="url(#ng3)">
              <circle cx={c.x} cy={c.y} r="9" fill={`${c.col}1a`} stroke={c.col} strokeWidth=".9"/>
              <circle cx={c.x} cy={c.y} r="2.5" fill={c.col}/>
              <text x={c.x} y={c.y+18} textAnchor="middle" fill={c.col}
                fontSize="7" fontFamily="JetBrains Mono,monospace"
                fontWeight="600" opacity=".9">{c.label}</text>
            </g>
          ))}
          <ScanLine2D/>
        </g>
      </svg>

      {/* ── LAYER 2: pink brain surface — masked so cursor hole shows interior ── */}
      <svg viewBox="0 0 500 400" className="brain2d__svg brain2d__svg--surface">
        <defs>
          {/* White mask = visible. Black circle at cursor = transparent hole. */}
          <mask id="xrayMask" maskUnits="userSpaceOnUse">
            <rect width="500" height="400" fill="white"/>
            {/* cursor hole — cx/cy updated every rAF frame via ref */}
            <circle ref={svgRef} cx="-999" cy="-999" r="44" fill="black"/>
          </mask>
        </defs>
        <g mask="url(#xrayMask)">
          <rect width="500" height="400" fill="#060609"/>
          {F.map((f,i)=>(
            <polygon key={i} points={f.p}
              fill={fc(f.l)} stroke={fs(f.l)} strokeWidth=".75" strokeLinejoin="round"/>
          ))}
        </g>
      </svg>

      {/* ── Rim ring — moved by rAF ── */}
      <div ref={rimRef} className={`brain2d__rim ${inside?'brain2d__rim--on':''}`}/>

      {/* ── Label ── */}
      <AnimatePresence>
        {near && (
          <motion.div className="brain2d__label" key={near.id}
            initial={{opacity:0,y:5}} animate={{opacity:1,y:0}}
            exit={{opacity:0}} transition={{duration:.15}}>
            <span className="brain2d__label-dot" style={{background:near.col}}/>
            <span className="brain2d__label-name">{near.label}</span>
            <span className="brain2d__label-domain" style={{color:near.col}}>{near.domain}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {!inside && <div className="brain2d__hint">MOVE CURSOR TO X-RAY SCAN</div>}
    </div>
  );
}

function ScanLine2D() {
  const l = useRef(null), g = useRef(null), x = useRef(118), d = useRef(1);
  useEffect(()=>{
    let r;
    const t=()=>{
      x.current+=0.6*d.current;
      if(x.current>390) d.current=-1;
      if(x.current<118) d.current=1;
      if(l.current){l.current.setAttribute('x1',x.current);l.current.setAttribute('x2',x.current);}
      if(g.current){g.current.setAttribute('x1',x.current);g.current.setAttribute('x2',x.current);}
      r=requestAnimationFrame(t);
    };
    r=requestAnimationFrame(t);
    return()=>cancelAnimationFrame(r);
  },[]);
  return<>
    <line ref={g} x1="118" y1="40" x2="118" y2="370"
      stroke="rgba(99,102,241,.18)" strokeWidth="8" filter="url(#sg3)"/>
    <line ref={l} x1="118" y1="40" x2="118" y2="370"
      stroke="rgba(129,140,248,.85)" strokeWidth="1.1"/>
  </>;
}
