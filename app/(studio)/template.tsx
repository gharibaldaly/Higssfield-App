"use client";

import { motion } from "motion/react";

/** Page enter transition (skipped under prefers-reduced-motion via MotionConfig). */
export default function StudioTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      {children}
    </motion.div>
  );
}
