import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import './xrayMaterial';
import { nearestRegion } from './regions';
import { buildBrainGeometry } from './brainGeometry';

/* ── 3D label anchored to hit point ─────────────────────────────────────── */
function HitLabel({ position, text }) {
  return (
    <Html position={position} center distanceFactor={6} zIndexRange={[10, 0]}>
      <div style={{
        fontFamily:    "'JetBrains Mono', monospace",
        fontSize:      '10px',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color:         '#a5b4fc',
        background:    'rgba(4,4,14,0.9)',
        border:        '1px solid #6366f1',
        padding:       '5px 12px',
        whiteSpace:    'nowrap',
        pointerEvents: 'none',
        boxShadow:     '0 0 14px rgba(99,102,241,0.45)',
      }}>
        <span style={{ color: '#818cf8', marginRight: 7 }}>●</span>
        {text}
      </div>
    </Html>
  );
}

/* ── Main mesh ───────────────────────────────────────────────────────────── */
export default function BrainMesh() {
  const meshRef  = useRef();
  const matRef   = useRef();
  const groupRef = useRef();

  const [label,    setLabel]    = useState(null);
  const [labelPos, setLabelPos] = useState([0, 0, 0]);

  const targetHit = useRef(new THREE.Vector3(9999, 9999, 9999));
  const targetRot = useRef({ x: 0, y: 0 });
  const autoAngle = useRef(0);

  // Use the proper anatomy geometry from brainGeometry.js
  const geometry = useMemo(() => buildBrainGeometry(), []);

  const handlePointerMove = e => {
    e.stopPropagation();
    targetHit.current.copy(e.point);
    const region = nearestRegion(e.point);
    if (region) {
      setLabel(region.label);
      setLabelPos([e.point.x, e.point.y + 0.2, e.point.z]);
    }
    // Gentle cursor-follow tilt
    targetRot.current.x =  e.point.y * 0.18;
    targetRot.current.y =  e.point.x * 0.24;
  };

  const handlePointerOut = () => {
    setLabel(null);
    targetHit.current.set(9999, 9999, 9999);
  };

  useFrame((_, delta) => {
    if (matRef.current) {
      matRef.current.uHitPoint.lerp(targetHit.current, 0.18);
      matRef.current.uTime += delta;
    }
    if (groupRef.current) {
      autoAngle.current += delta * 0.20;
      groupRef.current.rotation.x +=
        (targetRot.current.x - groupRef.current.rotation.x) * 0.05;
      groupRef.current.rotation.y +=
        (targetRot.current.y + autoAngle.current - groupRef.current.rotation.y) * 0.04;
    }
  });

  return (
    // Start at a slight tilt so the two-hemisphere structure is visible immediately
    <group ref={groupRef} rotation={[0.15, 0.3, 0]}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
      >
        <xRayMaterial ref={matRef} flatShading />
      </mesh>
      {label && <HitLabel position={labelPos} text={label} />}
    </group>
  );
}
