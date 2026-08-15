import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';

const XRayMaterial = shaderMaterial(
  {
    uHitPoint:        new THREE.Vector3(9999, 9999, 9999),
    uRadius:          0.52,
    uFeather:         0.32,
    uSurfaceColor:    new THREE.Color('#f472b6'),   // exact pink from reference
    uSurfaceColorAlt: new THREE.Color('#fda4cf'),   // lighter facet highlight
    uDepthColor:      new THREE.Color('#818cf8'),   // indigo glow inside
    uDepthLine:       new THREE.Color('#a5b4fc'),   // lighter indigo circuit lines
    uTime:            0,
  },

  /* ── vertex ── */
  /* glsl */`
    varying vec3 vPos;
    varying vec3 vNormal;
    void main() {
      vPos    = position;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  /* ── fragment ── */
  /* glsl */`
    uniform vec3  uHitPoint;
    uniform float uRadius;
    uniform float uFeather;
    uniform vec3  uSurfaceColor;
    uniform vec3  uSurfaceColorAlt;
    uniform vec3  uDepthColor;
    uniform vec3  uDepthLine;
    uniform float uTime;
    varying vec3 vPos;
    varying vec3 vNormal;

    float faceLight(vec3 n) {
      vec3 lightDir = normalize(vec3(0.4, 0.8, 0.6));
      return clamp(dot(n, lightDir), 0.15, 1.0);
    }

    float depthPattern(vec3 p) {
      float grid  = abs(sin(p.x * 18.0)) * abs(sin(p.y * 18.0));
      float lines = smoothstep(0.92, 1.0, grid);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.4 + p.x * 6.0 + p.y * 4.0);
      return lines * (0.55 + 0.45 * pulse);
    }

    void main() {
      float light   = faceLight(vNormal);
      vec3  surface = mix(uSurfaceColor, uSurfaceColorAlt, light);

      float dist   = distance(vPos, uHitPoint);
      float reveal = 1.0 - smoothstep(uRadius, uRadius + uFeather, dist);

      float pattern = depthPattern(vPos * 3.0);
      vec3  depth   = mix(vec3(0.03, 0.04, 0.09), uDepthLine, pattern);
      depth = mix(depth, uDepthColor, pattern * 0.65);
      depth *= light * 0.85 + 0.3;

      vec3 color = mix(surface, depth, reveal);

      /* glowing rim at boundary — sells the scanner feel */
      float rim = smoothstep(uRadius - 0.03, uRadius, dist)
                - smoothstep(uRadius, uRadius + 0.03, dist);
      color += uDepthColor * rim * 1.6;

      gl_FragColor = vec4(color, 1.0);
    }
  `
);

extend({ XRayMaterial });
export default XRayMaterial;
