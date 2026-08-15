import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import BrainMesh from './BrainMesh';

export default function BrainScene() {
  return (
    <Canvas
      camera={{ position: [1.2, 0.5, 4.0], fov: 36 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      dpr={[1, 2]}
    >
      {/* 3-point lighting — matches reference image: bright top-right key */}
      <ambientLight intensity={0.48} color="#ffeaf4" />
      <directionalLight position={[ 2.5,  4,   3  ]} intensity={1.2}  color="#ffffff" />
      <directionalLight position={[-3,    1,  -1  ]} intensity={0.48} color="#ffb3cc" />
      <directionalLight position={[ 0,   -2,  -3  ]} intensity={0.25} color="#ffd0e8" />
      <Suspense fallback={null}>
        <BrainMesh />
      </Suspense>
    </Canvas>
  );
}
