'use client';

import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { pageTransition } from '@/lib/motion';

/** Wraps route content in a subtle enter transition, keyed by pathname. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      variants={pageTransition}
      initial="hidden"
      animate="show"
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10"
    >
      {children}
    </motion.div>
  );
}
