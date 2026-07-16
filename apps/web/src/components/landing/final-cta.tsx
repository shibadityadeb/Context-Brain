'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { NeuralField } from '@/components/brain/neural-field';
import { ACCENT, Reveal } from './shared';

export function FinalCTA({ onGetStarted }: { onGetStarted?: () => void }) {
  return (
    <section className="relative flex min-h-[80vh] items-center justify-center overflow-hidden px-5 py-28">
      <NeuralField
        className="absolute inset-0 h-full w-full opacity-50"
        variant="hero"
        interactive
      />
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(60% 60% at 50% 45%, ${ACCENT}22, transparent 70%)` }}
      />
      {/* fade into darkness at the bottom */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-[#05060d]" />

      <div className="relative text-center">
        <Reveal>
          <h2 className="mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl md:text-7xl">
            The living memory of your{' '}
            <span className="bg-gradient-to-r from-blue-300 to-indigo-300 bg-clip-text text-transparent">
              company starts here.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mx-auto mt-6 max-w-lg text-lg text-white/50">
            Connect your sources, and watch chaos become intelligence.
          </p>
        </Reveal>
        <Reveal delay={0.25}>
          <motion.button
            onClick={onGetStarted}
            data-magnetic
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            className="group mx-auto mt-10 inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-medium text-white"
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, #6366f1)`,
              boxShadow: `0 10px 60px -12px ${ACCENT}`,
            }}
          >
            Get started
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </motion.button>
        </Reveal>
      </div>
    </section>
  );
}
