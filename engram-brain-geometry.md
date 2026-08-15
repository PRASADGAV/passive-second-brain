# ENGRAM — Procedural Low-Poly Brain Geometry (Three.js)

Full replacement for `buildLowPolyBlob()` from the previous file. This one actually
sculpts brain-like structure — two hemispheres split by a central fissure, a wrinkled
cortex surface, a cerebellum bump, and a brainstem stub — instead of a single noisy
sphere. Still low-poly / flat-shaded to match your reference image.

No new npm packages needed beyond `three` itself.

---

## `src/three/brainGeometry.js`

```js
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// If your three version doesn't have `three/addons/...`, use instead:
// import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Deterministic pseudo-noise (no extra deps). Good enough for organic-looking
 * surface wrinkling — not true simplex noise, but reads the same at this scale.
 */
function noise3(x, y, z) {
  return (
    Math.sin(x * 5.2 + y * 3.1 + z * 1.7) * 0.5 +
    Math.sin(y * 6.7 + z * 4.3 + x * 2.1) * 0.3 +
    Math.sin(z * 4.1 + x * 5.9 + y * 3.6) * 0.2
  );
}

/**
 * Builds one hemisphere: an icosahedron squashed into a lobed ellipsoid, with
 * gyri/sulci wrinkling and a flattened inner face (the side that meets the
 * other hemisphere at the longitudinal fissure).
 *
 * @param {number} side  -1 for left hemisphere, +1 for right
 */
function buildHemisphere(side, detail = 3) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();

    // --- base lobe shaping ---
    // frontal lobe (front, +z) bulges forward and rounds down
    // temporal lobe (side, lower) hangs down and out
    // occipital lobe (back, -z) tapers
    let x = v.x * 0.62;                 // hemisphere width (half of full brain)
    let y = v.y * 0.78;                 // height
    let z = v.z;

    // stretch frontal (+z) slightly forward, taper occipital (-z)
    z *= n.z > 0 ? 1.15 : 0.9;
    // temporal lobe bulge: lower-outer region hangs down
    if (n.y < -0.1 && Math.abs(n.x) > 0.3) {
      y -= 0.18 * (1 - Math.abs(n.z));
      x *= 1.08;
    }

    // flatten the medial (inner) face so hemispheres sit flush at the fissure
    const medial = side > 0 ? Math.max(0, -n.x) : Math.max(0, n.x);
    x *= 1 - medial * 0.55;

    // push the whole lobe out to the correct side, offset from centerline
    x = side * (Math.abs(x) + 0.06);

    // --- cortex wrinkling (gyri / sulci) ---
    const wrinkle = noise3(n.x * 4.0, n.y * 4.0, n.z * 4.0) * 0.045;
    x += n.x * wrinkle;
    y += n.y * wrinkle;
    z += n.z * wrinkle;

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo.toNonIndexed(); // required for flat shading per-facet
}

/** Small bumpy sphere for the cerebellum, tucked under the occipital lobes. */
function buildCerebellum() {
  const geo = new THREE.IcosahedronGeometry(0.32, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const wrinkle = noise3(n.x * 8, n.y * 8, n.z * 8) * 0.03;
    v.addScaledVector(n, wrinkle);
    v.y *= 0.75; // flatten vertically — cerebellum is squatter than the cortex
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.translate(0, -0.62, -0.38); // tuck under + behind the hemispheres
  return geo.toNonIndexed();
}

/** Tapered stub for the brainstem. */
function buildBrainstem() {
  const geo = new THREE.CylinderGeometry(0.09, 0.14, 0.4, 8, 1);
  geo.translate(0, -0.92, -0.15);
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/**
 * Full brain geometry: left hemisphere + right hemisphere + cerebellum + brainstem,
 * merged into a single BufferGeometry so one material / one shader covers all of it.
 */
export function buildBrainGeometry() {
  const left = buildHemisphere(-1);
  const right = buildHemisphere(1);
  const cerebellum = buildCerebellum();
  const brainstem = buildBrainstem();

  const merged = mergeGeometries([left, right, cerebellum, brainstem], false);
  merged.computeVertexNormals();
  merged.center(); // recenter so the whole brain rotates around its own middle
  return merged;
}
```

---

## Using it

In `BrainMesh.jsx`, swap:

```js
import { buildLowPolyBlob } from ...
const geometry = useMemo(() => buildLowPolyBlob(), []);
```

for:

```js
import { buildBrainGeometry } from './brainGeometry';
const geometry = useMemo(() => buildBrainGeometry(), []);
```

Everything else (the `xRayMaterial`, hit-point uniform, region labels, rotation-follow)
plugs in unchanged — the shader paints whatever geometry it's given.

---

## If `three/addons/...` import fails

Your Three.js version determines the import path for `BufferGeometryUtils`:

- Three **r160+**: `three/addons/utils/BufferGeometryUtils.js`
- Three **r150–r159** or bundler without addons alias: `three/examples/jsm/utils/BufferGeometryUtils.js`

Check your installed version with `npm ls three` and use the matching path. If your
bundler complains about resolving either, copy `mergeGeometries` out of that file
directly into your project — it's a pure function with no other Three internals
required beyond `THREE.BufferGeometry`.

---

## Tuning knobs

| What | Where | Effect |
|---|---|---|
| Overall wrinkliness | `wrinkle` multiplier (`0.045`) in `buildHemisphere` | higher = more chaotic gyri, lower = smoother lobes |
| Facet size | `detail` param (default `3`) in `buildHemisphere` | lower = chunkier low-poly facets, higher = smoother/rounder |
| Hemisphere gap at fissure | the `0.06` offset in the `x = side * (...)` line | increase for a more visible central groove |
| Cerebellum size/position | `buildCerebellum()` radius + `.translate(...)` | matches your reference image's under-hang bump |

Drop `detail` to `2` if you want it chunkier and closer to your reference image's
facet size — `3` gives noticeably smoother wrinkling but more triangles.
