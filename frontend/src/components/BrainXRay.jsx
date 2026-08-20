import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * BrainXRay — Interactive X-ray brain visualization
 * 
 * Surface: Full-color holographic brain image
 * Depth: Same image with blue X-ray filter
 * Interaction: Cursor creates a circular lens that reveals depth layer
 * 
 * Based on engram-3d-xray-brain.md spec
 */

export default function BrainXRay() {
  const containerRef = useRef(null);
  const rimRef = useRef(null);
  const [entered, setEntered] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Set initial position off-screen
    el.style.setProperty('--x', '-200px');
    el.style.setProperty('--y', '-200px');

    let raf = null;
    const handleMove = e => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (raf) return;
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--x', `${x}px`);
        el.style.setProperty('--y', `${y}px`);
        
        if (rimRef.current) {
          rimRef.current.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
        }
        
        raf = null;
      });
    };

    const handleEnter = () => setEntered(true);
    const handleLeave = () => {
      setEntered(false);
      el.style.setProperty('--x', '-200px');
      el.style.setProperty('--y', '-200px');
    };

    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseenter', handleEnter);
    el.addEventListener('mouseleave', handleLeave);

    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseenter', handleEnter);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="brain-xray"
      aria-label="Interactive X-ray brain visualization"
    >
      {/* Depth layer — X-ray interior view (blue tint, high contrast) */}
      <div className="brain-xray__depth">
        <img 
          src="https://i.imgur.com/9QZ8ZJX.png"
          alt="Brain X-ray interior"
          className="brain-xray__img brain-xray__img--xray"
          onLoad={() => setLoading(false)}
        />
        {/* Pulsing glow nodes overlay */}
        <div className="brain-xray__nodes" aria-hidden="true">
          <div className="brain-xray__node" style={{left: '25%', top: '30%', animationDelay: '0s'}} />
          <div className="brain-xray__node" style={{left: '45%', top: '25%', animationDelay: '0.3s'}} />
          <div className="brain-xray__node" style={{left: '65%', top: '35%', animationDelay: '0.6s'}} />
          <div className="brain-xray__node" style={{left: '35%', top: '55%', animationDelay: '0.9s'}} />
          <div className="brain-xray__node" style={{left: '55%', top: '60%', animationDelay: '1.2s'}} />
          <div className="brain-xray__node" style={{left: '75%', top: '50%', animationDelay: '1.5s'}} />
        </div>
      </div>

      {/* Surface layer — Full-color holographic brain */}
      <div className="brain-xray__surface">
        <img 
          src="https://i.imgur.com/9QZ8ZJX.png"
          alt="Holographic brain"
          className="brain-xray__img brain-xray__img--surface"
        />
        {/* Subtle scan line animation */}
        <div className="brain-xray__scanline" aria-hidden="true" />
      </div>

      {/* Lens rim — glowing circle that follows cursor */}
      <div 
        ref={rimRef} 
        className={`brain-xray__rim ${entered ? 'brain-xray__rim--visible' : ''}`}
      />

      {/* Instruction text */}
      {!entered && !loading && (
        <motion.div 
          className="brain-xray__hint"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="brain-xray__hint-icon">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.5"/>
            <circle cx="10" cy="10" r="2" fill="currentColor" opacity="0.8"/>
          </svg>
          <span>Move cursor to X-ray scan</span>
        </motion.div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="brain-xray__loading">
          <div className="brain-xray__spinner" />
          <span>Initializing neural scan...</span>
        </div>
      )}
    </div>
  );
}
