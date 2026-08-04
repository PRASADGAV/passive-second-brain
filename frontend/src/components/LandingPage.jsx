import { motion } from 'framer-motion';

const featurePills = ['Embedded recall', 'Live memory graph', 'Editorial workflow'];

/**
 * LandingPage — OBYS editorial style.
 * Giant Bebas Neue headline, white background, zero gradients.
 */
export default function LandingPage({ onEnter }) {
  return (
    <div className="landing-page">
      <motion.div
        className="landing-page__hero"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Left column */}
        <div className="landing-page__content">
          <div className="landing-page__eyebrow-row">
            <p className="eyebrow">AI Memory OS</p>
            <span className="landing-page__meta">01 / 01</span>
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="headline-line">PASSIVE</span>
            <span className="headline-line">SECOND</span>
            <span className="headline-line">BRAIN</span>
          </motion.h1>

          <motion.p
            className="landing-page__description"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
          >
            Capture ideas, connect concepts, and revisit knowledge through a calm, minimal workspace designed for modern thinking.
          </motion.p>

          <motion.div
            className="landing-page__pill-row"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
          >
            {featurePills.map(pill => (
              <span className="landing-page__pill" key={pill}>{pill}</span>
            ))}
          </motion.div>

          <motion.div
            className="landing-page__actions"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
          >
            <button
              className="landing-page__btn landing-page__btn--primary"
              onClick={onEnter}
              data-cursor="hover"
            >
              Enter Workspace
            </button>
            <button className="landing-page__btn landing-page__btn--ghost" data-cursor="hover">
              Explore Capabilities
            </button>
          </motion.div>
        </div>

        {/* Right column — feature cards */}
        <motion.div
          className="landing-page__panel"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="landing-page__card landing-page__card--large">
            <span className="landing-page__card-badge">● Live</span>
            <span className="landing-page__card-title">Capture</span>
            <span className="landing-page__card-text">
              Ingest URLs, notes, and PDFs into a living memory graph. The extension captures passively while you browse.
            </span>
          </div>

          <div className="landing-page__stack">
            <div className="landing-page__card">
              <span className="landing-page__card-title">Connect</span>
              <span className="landing-page__card-text">
                Reveal relationships between ideas and surface patterns instantly.
              </span>
            </div>
            <div className="landing-page__card">
              <span className="landing-page__card-title">Recall</span>
              <span className="landing-page__card-text">
                Ask questions grounded in your own knowledge and memory context.
              </span>
            </div>
          </div>

          <div className="landing-page__footer">
            <span>Built for architects of thought.</span>
            <span className="landing-page__footer-accent">B.Tech Capstone · 2025</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
