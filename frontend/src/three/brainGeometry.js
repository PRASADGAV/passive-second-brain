import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Deterministic pseudo-noise — no extra deps.
 * Produces organic surface variation that reads as gyri/sulci at this scale.
 */
function noise3(x, y, z) {
  return (
    Math.sin(x * 5.2 + y * 3.1 + z * 1.7) * 0.5 +
    Math.sin(y * 6.7 + z * 4.3 + x * 2.1) * 0.3 +
    Math.sin(z * 4.1 + x * 5.9 + y * 3.6) * 0.2
  );
}

/**
 * One hemisphere: icosahedron deformed into a lobed ellipsoid with
 * gyri/sulci wrinkling and a flattened medial face (the longitudinal fissure).
 *
 * detail=2 → chunkier, closer to the reference image facet size
 * detail=3 → smoother wrinkles, more triangles
 */
function buildHemisphere(side, detail = 2) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v   = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();

    let x = v.x * 0.62; // hemisphere width (half of full brain)
    let y = v.y * 0.78; // height
    let z = v.z;

    // frontal lobe bulge forward, occipital tapers
    z *= n.z > 0 ? 1.15 : 0.9;

    // temporal lobe: lower-outer region hangs down and out
    if (n.y < -0.1 && Math.abs(n.x) > 0.3) {
      y -= 0.18 * (1 - Math.abs(n.z));
      x *= 1.08;
    }

    // flatten medial face so hemispheres sit flush at the fissure
    const medial = side > 0 ? Math.max(0, -n.x) : Math.max(0, n.x);
    x *= 1 - medial * 0.55;

    // push lobe to correct side with small centerline offset
    x = side * (Math.abs(x) + 0.06);

    // cortex wrinkling (gyri / sulci)
    const wrinkle = noise3(n.x * 4.0, n.y * 4.0, n.z * 4.0) * 0.045;
    x += n.x * wrinkle;
    y += n.y * wrinkle;
    z += n.z * wrinkle;

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo.toNonIndexed(); // flat shading requires non-indexed
}

/** Bumpy sphere for the cerebellum — tucked under/behind the hemispheres. */
function buildCerebellum() {
  const geo = new THREE.IcosahedronGeometry(0.32, 2);
  const pos = geo.attributes.position;
  const v   = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const wrinkle = noise3(n.x * 8, n.y * 8, n.z * 8) * 0.03;
    v.addScaledVector(n, wrinkle);
    v.y *= 0.75; // squash vertically
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  geo.translate(0, -0.62, -0.38); // under + behind hemispheres
  return geo.toNonIndexed();
}

/** Tapered brainstem stub. */
function buildBrainstem() {
  const geo = new THREE.CylinderGeometry(0.09, 0.14, 0.4, 8, 1);
  geo.translate(0, -0.92, -0.15);
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/**
 * Full brain: left hemisphere + right hemisphere + cerebellum + brainstem
 * merged into a single BufferGeometry for one material / one shader.
 */
export function buildBrainGeometry() {
  const left       = buildHemisphere(-1);
  const right      = buildHemisphere(1);
  const cerebellum = buildCerebellum();
  const brainstem  = buildBrainstem();

  const merged = mergeGeometries([left, right, cerebellum, brainstem], false);
  merged.computeVertexNormals();
  merged.center(); // rotate around own center
  return merged;
}
