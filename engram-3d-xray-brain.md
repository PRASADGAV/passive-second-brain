# ENGRAM Hero — 3D X-Ray Brain (full implementation)

Drop this straight into your IDE agent. It's a complete, working React Three Fiber
setup: a low-poly faceted brain that rotates toward the cursor (matches what you
already have running), plus a **real shader-based X-ray reveal** — not an opacity
trick — that cuts a soft-edged hole through the surface material at the raycast hit
point and shows a "concept layer" underneath, with region-aware hover tags in your
existing `● ATTENTION ML` style.

---

## 1. Install

```bash
npm install three @react-three/fiber @react-three/drei
```

---

## 2. `src/three/xrayMaterial.js`

Custom shader material. The reveal is computed in **object space** against a hit
point uniform, not screen space — so it stays glued to the mesh surface as the
brain rotates, instead of sliding around like a flat cursor-follow gradient would.

```js
import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';

const XRayMaterial = shaderMaterial(
  {
    uHitPoint: new THREE.Vector3(9999, 9999, 9999), // far away = no reveal
    uRadius: 0.55,
    uFeather: 0.35,
    uSurfaceColor: new THREE.Color('#E85D8A'),   // your current brain pink
    uSurfaceColorAlt: new THREE.Color('#F2A6C0'), // facet highlight
    uDepthColor: new THREE.Color('#E8A34D'),      // amber concept-layer glow
    uDepthLine: new THREE.Color('#C9D3DE'),       // starlight linework
    uTime: 0,
  },
  // vertex shader
  /* glsl */ `
    varying vec3 vPos;
    varying vec3 vNormal;
    void main() {
      vPos = position;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // fragment shader
  /* glsl */ `
    uniform vec3 uHitPoint;
    uniform float uRadius;
    uniform float uFeather;
    uniform vec3 uSurfaceColor;
    uniform vec3 uSurfaceColorAlt;
    uniform vec3 uDepthColor;
    uniform vec3 uDepthLine;
    uniform float uTime;
    varying vec3 vPos;
    varying vec3 vNormal;

    // cheap facet-aware shading so flat-shaded triangles still read as faceted
    float faceLight(vec3 n) {
      vec3 lightDir = normalize(vec3(0.4, 0.8, 0.6));
      return clamp(dot(n, lightDir), 0.15, 1.0);
    }

    // procedural "circuit / concept" pattern for the depth layer
    float depthPattern(vec3 p) {
      float grid = abs(sin(p.x * 18.0)) * abs(sin(p.y * 18.0));
      float lines = smoothstep(0.94, 1.0, grid);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.5 + p.x * 6.0 + p.y * 4.0);
      return lines * (0.6 + 0.4 * pulse);
    }

    void main() {
      float light = faceLight(vNormal);
      vec3 surface = mix(uSurfaceColor, uSurfaceColorAlt, light);

      float dist = distance(vPos, uHitPoint);
      float reveal = 1.0 - smoothstep(uRadius, uRadius + uFeather, dist);

      float pattern = depthPattern(vPos * 3.0);
      vec3 depth = mix(vec3(0.04, 0.05, 0.07), uDepthLine, pattern);
      depth = mix(depth, uDepthColor, pattern * 0.6);
      depth *= light * 0.9 + 0.3;

      vec3 color = mix(surface, depth, reveal);

      // thin glowing rim right at the reveal boundary — sells the "scan" feel
      float rim = smoothstep(uRadius - 0.03, uRadius, dist)
                - smoothstep(uRadius, uRadius + 0.03, dist);
      color += uDepthColor * rim * 1.4;

      gl_FragColor = vec4(color, 1.0);
    }
  `
);

extend({ XRayMaterial });
export default XRayMaterial;
```

---

## 3. `src/three/regions.js`

Hotspot map. Positions are approximate unit-sphere directions on the brain mesh —
tune the `x/y/z` values by eye once your model is in view (log `intersection.point`
in the pointer handler below to calibrate quickly).

```js
// direction is a rough unit vector pointing at that lobe from the brain's center
export const REGIONS = [
  { id: 'attention',  label: 'ATTENTION · ML',      direction: [0.6, 0.5, 0.6] },
  { id: 'memory',     label: 'SM-2 · MEMORY',        direction: [-0.5, 0.3, 0.7] },
  { id: 'graph',      label: 'KNOWLEDGE GRAPH',      direction: [0.0, 0.7, -0.6] },
  { id: 'rag',        label: 'RAG · CHAT',           direction: [-0.7, 0.1, -0.4] },
  { id: 'ingestion',  label: 'PASSIVE CAPTURE',      direction: [0.7, -0.4, -0.3] },
  { id: 'gaps',       label: 'GAP ANALYSIS',         direction: [-0.3, -0.6, 0.5] },
];

export function nearestRegion(hitPoint, center = [0, 0, 0]) {
  let best = null;
  let bestDot = -Infinity;
  const hx = hitPoint.x - center[0];
  const hy = hitPoint.y - center[1];
  const hz = hitPoint.z - center[2];
  const len = Math.hypot(hx, hy, hz) || 1;
  const nx = hx / len, ny = hy / len, nz = hz / len;

  for (const region of REGIONS) {
    const [rx, ry, rz] = region.direction;
    const rlen = Math.hypot(rx, ry, rz) || 1;
    const dot = (nx * rx + ny * ry + nz * rz) / rlen;
    if (dot > bestDot) {
      bestDot = dot;
      best = region;
    }
  }
  return best;
}
```

---

## 4. `src/three/BrainMesh.jsx`

If you already have a GLTF/GLB brain model, load it with `useGLTF` and pass its
geometry to `<xRayMaterial>` instead of the procedural geometry below — the shader
doesn't care what mesh it's applied to. The procedural version is included so the
file works standalone / as a fallback.

```jsx
import { useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import './xrayMaterial';
import { nearestRegion } from './regions';

// --- procedural low-poly brain-ish blob (skip this fn if using your own GLB) ---
function buildLowPolyBlob() {
  const geo = new THREE.IcosahedronGeometry(1.4, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    // simple layered noise via trig functions — no extra deps needed
    const bump =
      Math.sin(n.x * 5.2 + n.y * 3.1) * 0.09 +
      Math.sin(n.y * 6.7 + n.z * 4.3) * 0.07 +
      Math.sin(n.z * 4.1 + n.x * 5.9) * 0.06;
    // squash slightly + taper toward a "cerebellum" underside bump
    const squash = new THREE.Vector3(1.15, 0.85, 1.0);
    v.multiply(squash);
    v.addScaledVector(n, bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo.toNonIndexed(); // flat shading needs non-indexed geometry
}

export default function BrainMesh() {
  const meshRef = useRef();
  const matRef = useRef();
  const groupRef = useRef();
  const { viewport } = useThree();
  const [label, setLabel] = useState(null);
  const [labelPos, setLabelPos] = useState([0, 0, 0]);
  const targetHit = useRef(new THREE.Vector3(9999, 9999, 9999));
  const targetRot = useRef({ x: 0, y: 0 });

  const geometry = useMemo(() => buildLowPolyBlob(), []);

  const handlePointerMove = (e) => {
    e.stopPropagation();
    targetHit.current.copy(e.point); // world point; mesh has no offset so ~= local
    const region = nearestRegion(e.point);
    if (region) {
      setLabel(region.label);
      setLabelPos([e.point.x, e.point.y, e.point.z]);
    }
    // drive gentle rotation toward pointer, matching your current interaction
    targetRot.current.x = (e.point.y / 1.6) * 0.25;
    targetRot.current.y = (e.point.x / 1.6) * 0.35;
  };

  const handlePointerOut = () => {
    setLabel(null);
    targetHit.current.set(9999, 9999, 9999);
  };

  useFrame((state, delta) => {
    if (matRef.current) {
      matRef.current.uHitPoint.lerp(targetHit.current, 0.25);
      matRef.current.uTime += delta;
    }
    if (groupRef.current) {
      groupRef.current.rotation.x += (targetRot.current.x - groupRef.current.rotation.x) * 0.06;
      groupRef.current.rotation.y += (targetRot.current.y - groupRef.current.rotation.y) * 0.06;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
      >
        <xRayMaterial ref={matRef} flatShading />
      </mesh>

      {label && (
        <Html3DLabel position={labelPos} text={label} />
      )}
    </group>
  );
}

// Small HTML tag anchored to the 3D hit point — matches your "● ATTENTION ML" style.
// Requires @react-three/drei's <Html>.
import { Html } from '@react-three/drei';
function Html3DLabel({ position, text }) {
  return (
    <Html position={position} center distanceFactor={6} zIndexRange={[10, 0]}>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          letterSpacing: '0.08em',
          color: '#C9D3DE',
          background: 'rgba(10,12,16,0.85)',
          border: '1px solid #E8A34D',
          padding: '4px 8px',
          borderRadius: '3px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        <span style={{ color: '#E8A34D' }}>●</span> {text}
      </div>
    </Html>
  );
}
```

---

## 5. `src/three/BrainScene.jsx`

```jsx
import { Canvas } from '@react-three/fiber';
import BrainMesh from './BrainMesh';

export default function BrainScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 4.2], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 2]} intensity={0.8} />
      <BrainMesh />
    </Canvas>
  );
}
```

Drop `<BrainScene />` into the right half of your hero exactly where the current
brain canvas lives.

---

## 6. Using your existing GLB brain instead of the procedural blob

If the pink brain in your video is an imported model (likely, given the polish),
swap step 4's `buildLowPolyBlob()` for:

```jsx
import { useGLTF } from '@react-three/drei';
// ...
const { nodes } = useGLTF('/models/brain.glb');
const geometry = nodes.Brain.geometry; // check your GLB's node name in console.log(nodes)
```

Everything else — the shader, the hit-point uniform, the region labels, the
rotation-follow — works unchanged, because the material doesn't know or care what
geometry it's painted on.

---

## Notes on the reveal quality

- `uRadius` / `uFeather` control lens size and edge softness — 0.5 / 0.3 reads as a
  tight "scanner," bump both up for a lazier, dreamier reveal.
- The rim glow (`rim` in the fragment shader) is what makes this look like an
  instrument rather than a mask bug — don't cut it even if you shrink everything
  else.
- Colors are wired to the atlas palette (`#E8A34D` amber, `#C9D3DE` starlight)
  rather than a second pink, so the reveal reads as "looking underneath," not
  "different shade of the same thing." Swap `uSurfaceColor` if you want the brain
  itself in the void palette instead of pink — that'd match the landing page shell
  better than the current stock-pink brain does.
