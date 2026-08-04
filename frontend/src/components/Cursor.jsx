import { useEffect, useRef } from 'react';

/**
 * Cursor — Custom Obys-style cursor with lerp-based smooth following.
 * Default: 10px black dot. On hover of [data-cursor="hover"]: expands to 32px ring.
 */
export default function Cursor() {
  const cursorRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const mouse = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };

    const loop = () => {
      pos.current.x += (mouse.current.x - pos.current.x) * 0.16;
      pos.current.y += (mouse.current.y - pos.current.y) * 0.16;
      if (cursorRef.current) {
        cursorRef.current.style.transform =
          `translate(${pos.current.x - 5}px, ${pos.current.y - 5}px)`;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    const onEnter = () => cursorRef.current?.classList.add('expanded');
    const onLeave = () => cursorRef.current?.classList.remove('expanded');

    document.addEventListener('mousemove', onMove);
    rafRef.current = requestAnimationFrame(loop);

    const attachHover = () => {
      document.querySelectorAll('[data-cursor="hover"]').forEach((el) => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
        el.addEventListener('mouseenter', onEnter);
        el.addEventListener('mouseleave', onLeave);
      });
    };

    attachHover();
    const observer = new MutationObserver(attachHover);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
    };
  }, []);

  return <div className="psb-cursor" ref={cursorRef} />;
}
