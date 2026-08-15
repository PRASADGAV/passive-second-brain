# Prompt: Cursor X-Ray Reveal — Hero Section

Paste this into your IDE agent (Cursor, Windsurf, etc.).

---

Build a hero-section interaction called the **Cognitive X-Ray Reveal**.

## Concept

There are two stacked images of identical size, same position, absolutely layered on top of each other inside one container:

1. **Surface layer** (top, always visible) — the brain graphic (or whatever the final hero art is).
2. **Depth layer** (bottom, hidden by default) — a diagram of concept clusters/domains "inside" the brain: engineering, NLP/language, math/logic, systems, vision — laid out so each cluster sits roughly under the matching lobe of the surface image.

As the user moves the mouse over the container, a circular "lens" cuts a hole through the surface layer at the cursor position, revealing the depth layer underneath in that exact spot only. Moving the cursor to a different region reveals the corresponding concept cluster in the depth layer at that region. Outside the lens, only the surface layer is visible.

## Required implementation details

**Masking, not opacity crossfade.** Use `mask-image` / `-webkit-mask-image` with a `radial-gradient` on the surface layer, not two absolutely-positioned images faded with opacity — opacity crossfade reveals the *whole* depth layer at low intensity everywhere, which is not the effect. The mask must physically cut a soft-edged circular hole:

```css
.surface-layer {
  mask-image: radial-gradient(
    circle at var(--x) var(--y),
    transparent 0px,
    transparent var(--lens-radius),
    black calc(var(--lens-radius) + var(--feather)),
    black 100%
  );
  -webkit-mask-image: radial-gradient(
    circle at var(--x) var(--y),
    transparent 0px,
    transparent var(--lens-radius),
    black calc(var(--lens-radius) + var(--feather)),
    black 100%
  );
}
```

`--lens-radius`: ~90px desktop. `--feather`: ~40px soft edge, not a hard circle.

**Performance: update CSS custom properties directly, do not use React state for mouse position.** A `setState` per `mousemove` will thrash re-renders. Instead:

```js
const containerRef = useRef(null);

useEffect(() => {
  const el = containerRef.current;
  let raf = null;
  const handleMove = (e) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      el.style.setProperty('--x', `${x}px`);
      el.style.setProperty('--y', `${y}px`);
      raf = null;
    });
  };
  el.addEventListener('mousemove', handleMove);
  return () => el.removeEventListener('mousemove', handleMove);
}, []);
```

**Lens has physical presence, not just a hole.** Add a thin glowing rim that tracks the cursor, drawn as a separate absolutely-positioned element following `--x`/`--y` via `transform: translate(x,y)` (also updated in the same rAF callback, not via React state). This sells the "instrument" feel — it should look like a scanner, not a CSS trick.

**Region-aware labels.** Divide the container into named hit-regions (a simple array of `{ id, xRange, yRange, label }`). On mousemove, determine which region the cursor is in and fade in a small mono-font label near the lens (e.g. "ENGINEERING · MEM.CLUSTER 03") with a ~150ms delay so it doesn't flicker between regions at boundaries. Debounce region changes, don't recompute on every frame.

**Depth layer content.** The depth layer should not just be a duplicate texture — it should be an actual diagram: faint circuit/graph-node linework for the engineering region, waveform/text glyphs for language, formula fragments for math, etc. Static SVG or canvas, doesn't need to be animated itself — the *reveal* is the animation, the content underneath should be calm.

**Mobile / touch fallback.** No hover on touch devices. On touch, either: (a) reveal the full depth layer at reduced opacity on tap-and-hold, or (b) skip the effect and show the depth layer as a static labeled diagram beneath the hero art. Do not attempt to fake hover with touchmove — it feels broken.

**Reduced motion.** Respect `prefers-reduced-motion: reduce` — disable the rim glow pulse/transition easing (jump instantly instead of animating), keep the mask functional since it's user-driven, not ambient motion.

## File targets

- New component: `src/components/XRayHero.jsx`
- Depth-layer SVG assets: `src/assets/depth-layer.svg` (or per-region SVGs if easier to composite)
- Styles co-located or in `XRayHero.css`
- Wire into `App.jsx` as the hero, above the existing top nav or replacing the current static header art

Keep the component self-contained and prop-driven (`surfaceSrc`, `depthSrc`, `regions[]`) so it isn't hardcoded to one image pair.
