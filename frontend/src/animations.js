/**
 * animations.js — Framer Motion presets for Obys-style transitions.
 */

export const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

export const stagger = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.06 } }
};

export const tabVariant = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0,
    transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, y: -8,
    transition: { duration: 0.15 } }
};

export const slideInRight = {
  initial: { x: "100%" },
  animate: { x: 0,
    transition: { type: "spring", stiffness: 400, damping: 40 } },
  exit:    { x: "100%",
    transition: { duration: 0.2, ease: "easeIn" } }
};

export const onboardingStep = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, x: -32,
    transition: { duration: 0.2 } }
};
