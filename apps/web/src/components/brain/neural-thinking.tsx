'use client';

import { motion } from 'framer-motion';

/**
 * Never a spinner. A tiny neural cluster firing: nodes pulse and a signal
 * travels between them while the Brain "thinks".
 */
export function NeuralThinking({ label }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2.5 text-sm text-muted-foreground">
      <svg width="40" height="18" viewBox="0 0 40 18" fill="none" aria-hidden>
        <motion.line
          x1="6"
          y1="9"
          x2="20"
          y2="4"
          stroke="hsl(var(--ai))"
          strokeWidth="1"
          initial={{ opacity: 0.2 }}
          animate={{ opacity: [0.2, 0.8, 0.2] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
        <motion.line
          x1="20"
          y1="4"
          x2="34"
          y2="12"
          stroke="hsl(var(--ai))"
          strokeWidth="1"
          initial={{ opacity: 0.2 }}
          animate={{ opacity: [0.2, 0.8, 0.2] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: 0.3 }}
        />
        <motion.line
          x1="6"
          y1="9"
          x2="34"
          y2="12"
          stroke="hsl(var(--ai))"
          strokeWidth="1"
          initial={{ opacity: 0.15 }}
          animate={{ opacity: [0.15, 0.5, 0.15] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: 0.6 }}
        />
        {[
          [6, 9],
          [20, 4],
          [34, 12],
        ].map(([cx, cy], i) => (
          <motion.circle
            key={i}
            cx={cx}
            cy={cy}
            r="2.4"
            fill="hsl(var(--ai))"
            initial={{ scale: 0.7, opacity: 0.5 }}
            animate={{ scale: [0.7, 1.3, 0.7], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
        <motion.circle
          r="1.6"
          fill="#fff"
          initial={{ cx: 6, cy: 9 }}
          animate={{ cx: [6, 20, 34], cy: [9, 4, 12] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      </svg>
      {label && <span>{label}</span>}
    </div>
  );
}
