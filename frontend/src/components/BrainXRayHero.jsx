import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';

/* ── Concept data ────────────────────────────────────────────────────────── */
const CONCEPTS = [
  { id:'tf',   label:'Transformers', domain:'ML'  },
  { id:'rag',  label:'RAG',          domain:'ML'  },
  { id:'sm2',  label:'SM-2',         domain:'Mem' },
  { id:'neo',  label:'Neo4j',        domain:'DB'  },
  { id:'dsa',  label:'DSA',          domain:'CS'  },
  { id:'llm',  label:'LLM',          domain:'ML'  },
  { id:'attn', label:'Attention',    domain:'ML'  },
  { id:'vec',  label:'Vectors',      domain:'ML'  },
  { id:'api',  label:'API Design',   domain:'Web' },
  { id:'py',   label:'Python',       domain:'Dev' },
];

const CONCEPT_POSITIONS = [
  [ 0.4,  0.55,  0.3],
  [ 0.8,  0.35,  0.1],
  [-0.6,  0.1,   0.2],
  [ 0.5, -0.05,  0.0],
  [-0.3, -0.2,  -0.2],
  [ 0.2,  0.7,  -0.1],
  [ 0.0,  0.4,   0.4],
  [ 0.6,  0.2,  -0.3],
  [-0.5,  0.4,  -0.1],
  [-0.1, -0.35,  0.1],
];

const CONCEPT_EDGES = [
  [0,1],[0,6],[1,3],[1,7],[2,4],[3,8],[4,9],[5,6],[5,7],[6,7],[7,0],[8,9],
];

/* ── Low-poly brain geometry ─────────────────────────────────────────────── */
function buildBrainGeometry() {
  const base = new THREE.IcosahedronGeometry(1.0, 2);
  const pos  = base.getAttribute('position');
  const v = [];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * 1.55;
    let y = pos.getY(i) * 1.22;
    let z = pos.getZ(i) * 0.9;
    if (y < -0.3) y *= 0.55;
    if (z > 0.1 && y > -0.1) z += 0.18 * Math.max(0, y + 0.4);
    if (z < -0.2) z *= 0.82;
    if (Math.abs(x) > 0.9 && y < 0.1 && y > -0.6) { y -= 0.18; x *= 1.12; }
    const f = 0.07;
    x += f * Math.sin(y * 4.2 + z * 2.8);
    y += f * Math.sin(x * 3.6 + z * 3.1);
    z += f * Math.sin(x * 2.9 + y * 4.5);
    v.push(x, y, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  geo.setIndex(base.getIndex());
  geo.computeVertexNormals();
  return geo;
}

function buildCerebellumGeometry() {
  const base = new THREE.IcosahedronGeometry(0.42, 1);
  const pos  = base.getAttribute('position');
  const v = [];
  for (let i = 0; i < pos.count; i++) {
    v.push(pos.getX(i) * 1.4, pos.getY(i) * 0.75, pos.getZ(i) * 0.85);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  geo.setIndex(base.getIndex());
  geo.computeVertexNormals();
  return geo;
}

/* ── Concept nodes + edges inside brain ─────────────────────────────────── */
function buildConceptNodes(scene) {
  const nodes = [];

  const mkLabel = text => {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 56;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 192, 56);
    ctx.fillStyle = '#a5b4fc';
    ctx.font = 'bold 17px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, 96, 36);
    return c;
  };

  CONCEPT_POSITIONS.forEach((pos, i) => {
    const group = new THREE.Group();
    group.position.set(...pos);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0 })
    );
    group.add(sphere);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.12, 20),
      new THREE.MeshBasicMaterial({
        color: 0x6366f1, side: THREE.DoubleSide, transparent: true, opacity: 0,
      })
    );
    group.add(ring);

    const spriteMat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(mkLabel(CONCEPTS[i].label)),
      transparent: true, opacity: 0,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.55, 0.16, 1);
    sprite.position.y = 0.15;
    group.add(sprite);

    scene.add(group);
    nodes.push({ group, sphere, ring, spriteMat, x: pos[0], idx: i });
  });

  CONCEPT_EDGES.forEach(([a, b]) => {
    const pa = new THREE.Vector3(...CONCEPT_POSITIONS[a]);
    const pb = new THREE.Vector3(...CONCEPT_POSITIONS[b]);
    const geo = new THREE.BufferGeometry().setFromPoints([pa, pb]);
    const mat = new THREE.LineBasicMaterial({
      color: 0x6366f1, transparent: true, opacity: 0,
    });
    scene.add(new THREE.Line(geo, mat));
    nodes.push({ isEdge: true, mat, x: (pa.x + pb.x) / 2 });
  });

  return nodes;
}

/* ── Main Component ──────────────────────────────────────────────────────── */
export default function BrainXRayHero() {
  const mountRef  = useRef(null);
  const [near,    setNear]    = useState(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const W = el.clientWidth  || 520;
    const H = el.clientHeight || 440;

    /* renderer */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 50);
    camera.position.set(0, 0.18, 4.9);

    /* lighting — matches pink low-poly brain look */
    scene.add(new THREE.AmbientLight(0xffeaf4, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(2.5, 3.5, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffb3cc, 0.48);
    fill.position.set(-3, 1, -1);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe0f0, 0.28);
    rim.position.set(0, -2, -3);
    scene.add(rim);

    /* brain */
    const brain = new THREE.Mesh(
      buildBrainGeometry(),
      new THREE.MeshPhongMaterial({
        color: 0xf472b6, specular: 0xff9ec8, shininess: 30, flatShading: true,
      })
    );
    brain.position.set(-0.08, 0.1, 0);
    scene.add(brain);

    /* cerebellum */
    const cereb = new THREE.Mesh(
      buildCerebellumGeometry(),
      new THREE.MeshPhongMaterial({
        color: 0xe879a8, specular: 0xff9ec8, shininess: 22, flatShading: true,
      })
    );
    cereb.position.set(0.84, -0.74, -0.2);
    scene.add(cereb);

    /* brainstem */
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.14, 0.46, 5),
      new THREE.MeshPhongMaterial({ color: 0xd4608e, flatShading: true })
    );
    stem.position.set(0.90, -1.02, -0.12);
    stem.rotation.z = 0.18;
    scene.add(stem);

    /* group all brain parts so they rotate together */
    const brainGroup = new THREE.Group();
    brainGroup.add(brain);
    brainGroup.add(cereb);
    brainGroup.add(stem);
    scene.add(brainGroup);

    /* concept nodes */
    const nodes = buildConceptNodes(scene);

    /* scan plane */
    const scanMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 3.4),
      new THREE.MeshBasicMaterial({
        color: 0x818cf8, side: THREE.DoubleSide, transparent: true, opacity: 0.22,
      })
    );
    scanMesh.rotation.y = Math.PI / 2;
    scene.add(scanMesh);

    /* animation state */
    let scanX = -1.9, scanDir = 1;
    let autoAngle = 0;
    let tRX = 0, tRY = 0;

    /* mouse */
    const onMove = e => {
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width  - 0.5;
      const ny = (e.clientY - r.top)  / r.height - 0.5;
      tRX = -ny * 0.38;
      tRY =  nx * 0.52;
      setEntered(true);

      /* nearest concept */
      let best = null, bd = 70;
      nodes.forEach(n => {
        if (n.isEdge) return;
        const wp = n.group.position.clone().applyEuler(brainGroup.rotation);
        const p  = wp.project(camera);
        const sx = (p.x * 0.5 + 0.5) * r.width;
        const sy = (1 - (p.y * 0.5 + 0.5)) * r.height;
        const d  = Math.hypot(sx - (e.clientX - r.left), sy - (e.clientY - r.top));
        if (d < bd) { best = n; bd = d; }
      });
      setNear(best ? CONCEPTS[best.idx] : null);
    };
    const onLeave = () => { tRX = 0; tRY = 0; setEntered(false); setNear(null); };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);

    /* resize */
    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    /* loop */
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);

      autoAngle += 0.003;
      brainGroup.rotation.y += (tRY + autoAngle - brainGroup.rotation.y) * 0.04;
      brainGroup.rotation.x += (tRX - brainGroup.rotation.x) * 0.04;

      scanX += 0.013 * scanDir;
      if (scanX >  1.9) scanDir = -1;
      if (scanX < -1.9) scanDir =  1;
      scanMesh.position.x = scanX;

      /* reveal nodes and edges near scan plane */
      nodes.forEach(n => {
        if (n.isEdge) {
          const op = Math.max(0, 1 - Math.abs(n.x - scanX) * 2.0) * 0.6;
          n.mat.opacity = op;
          return;
        }
        const reveal = Math.max(0, 1 - Math.abs(n.group.position.x - scanX) * 1.7);
        n.sphere.material.opacity = reveal * 0.95;
        n.ring.material.opacity   = reveal * 0.7;
        n.spriteMat.opacity       = reveal * 0.9;
      });

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={mountRef} className="brain-xray3d">
      <AnimatePresence>
        {near && (
          <motion.div className="brain-xray__label" key={near.id}
            initial={{ opacity:0, y:5 }} animate={{ opacity:1, y:0 }}
            exit={{ opacity:0 }} transition={{ duration:.18 }}>
            <span className="brain-xray__label-dot"/>
            {near.label}
            <span className="brain-xray__label-domain">{near.domain}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {!entered && <div className="brain-xray__hint">MOVE CURSOR TO EXPLORE</div>}
    </div>
  );
}
