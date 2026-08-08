import { useEffect, useRef } from 'react';

/**
 * Cursor — adaptive color cursor.
 *
 * Samples the background color of the element under the cursor every frame.
 * If the background is light  → cursor turns dark  (#0D0D0D)
 * If the background is dark   → cursor turns white (#FAFAF8)
 * On hover of [data-cursor="hover"] → expands to a ring (mix-blend-mode: difference)
 */

// ── helpers ────────────────────────────────────────────────────────────────────

/** Parse any CSS colour string → { r, g, b } or null */
function parseRGB(color) {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
  const m =
    color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) ||
    color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  // hex fallback
  const hex = color.replace('#', '');
  if (hex.length === 3)
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  if (hex.length === 6)
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  return null;
}

/**
 * Walk up the DOM from el to find the first opaque background colour.
 * Falls back to the <html> background, then defaults to white.
 */
function getBackgroundAt(x, y) {
  // hide cursor so it doesn't sample itself
  let el = document.elementFromPoint(x, y);
  if (!el) return { r: 255, g: 255, b: 255 };

  while (el && el !== document.documentElement) {
    const bg = window.getComputedStyle(el).backgroundColor;
    const rgb = parseRGB(bg);
    if (rgb) return rgb;
    el = el.parentElement;
  }
  // fallback: html / body background
  const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  return parseRGB(htmlBg) || parseRGB(bodyBg) || { r: 255, g: 255, b: 255 };
}

/** Relative luminance (WCAG formula) */
function luminance({ r, g, b }) {
  const toLinear = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** true = background is light, cursor should be dark */
function isLightBg(rgb) {
  return luminance(rgb) > 0.35;
}

// ── component ─────────────────────────────────────────────────────────────────
export default function Cursor() {
  const cursorRef  = useRef(null);
  const ringRef    = useRef(null);
  const pos        = useRef({ x: -100, y: -100 });
  const mouse      = useRef({ x: -100, y: -100 });
  const hovered    = useRef(false);
  const rafRef     = useRef(null);
  // track current theme to avoid redundant DOM writes
  const themeRef   = useRef('dark'); // 'dark' | 'light'

  useEffect(() => {
    const onMove = e => { mouse.current = { x: e.clientX, y: e.clientY }; };

    // expand / contract ring on interactive elements
    const onEnter = () => { hovered.current = true;  ringRef.current?.classList.add('expanded'); };
    const onLeave = () => { hovered.current = false; ringRef.current?.classList.remove('expanded'); };

    const attachHover = () => {
      document.querySelectorAll('[data-cursor="hover"]').forEach(el => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
        el.addEventListener('mouseenter', onEnter);
        el.addEventListener('mouseleave', onLeave);
      });
    };
    attachHover();
    const observer = new MutationObserver(attachHover);
    observer.observe(document.body, { childList: true, subtree: true });

    // RAF loop — lerp dot, sample bg, update colours
    let frame = 0;
    const loop = () => {
      // smooth follow
      pos.current.x += (mouse.current.x - pos.current.x) * 0.18;
      pos.current.y += (mouse.current.y - pos.current.y) * 0.18;

      const cx = pos.current.x;
      const cy = pos.current.y;

      // move dot
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate(${cx - 5}px, ${cy - 5}px)`;
      }
      // move ring (slightly more lag for feel)
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${cx - 16}px, ${cy - 16}px)`;
      }

      // sample background every 4 frames (plenty fast, cheap)
      if (frame % 4 === 0) {
        // temporarily hide both cursor elements so elementFromPoint ignores them
        if (cursorRef.current) cursorRef.current.style.visibility = 'hidden';
        if (ringRef.current)   ringRef.current.style.visibility   = 'hidden';

        const bg   = getBackgroundAt(Math.round(cx), Math.round(cy));
        const theme = isLightBg(bg) ? 'light' : 'dark';

        if (cursorRef.current) cursorRef.current.style.visibility = '';
        if (ringRef.current)   ringRef.current.style.visibility   = '';

        if (theme !== themeRef.current) {
          themeRef.current = theme;
          const dotColor  = theme === 'light' ? '#0D0D0D' : '#FAFAF8';
          const ringColor = theme === 'light' ? '#0D0D0D' : '#FAFAF8';
          if (cursorRef.current) cursorRef.current.style.background = dotColor;
          if (ringRef.current)   ringRef.current.style.borderColor  = ringColor;
        }
      }

      frame++;
      rafRef.current = requestAnimationFrame(loop);
    };

    document.addEventListener('mousemove', onMove);
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      document.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {/* Small filled dot — follows cursor precisely */}
      <div className="psb-cursor__dot" ref={cursorRef} />
      {/* Larger ring — expands on hover, mix-blend-mode: difference */}
      <div className="psb-cursor__ring" ref={ringRef} />
    </>
  );
}
