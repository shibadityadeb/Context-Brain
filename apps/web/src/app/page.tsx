'use client';

import Image from 'next/image';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { GOOGLE_SIGN_IN_URL } from '@/lib/api';
import { NeuralField } from '@/components/brain/neural-field';
import { KnowledgeScatter } from '@/components/landing/knowledge-scatter';
import { SearchExperience } from '@/components/landing/search-experience';
import { KnowledgeGraph } from '@/components/landing/knowledge-graph';
import { AIReasoning } from '@/components/landing/ai-reasoning';
import { MemoryTimeline } from '@/components/landing/memory-timeline';
import { Actions } from '@/components/landing/actions';
import { Integrations } from '@/components/landing/integrations';
import { Enterprise } from '@/components/landing/enterprise';
import { Testimonials } from '@/components/landing/testimonials';
import { FinalCTA } from '@/components/landing/final-cta';
import { Footer } from '@/components/landing/footer';

const EASE = [0.22, 1, 0.36, 1] as const;

export default function Landing() {
  const [entering, setEntering] = useState(false);

  function getStarted() {
    // Let the in-app boot skip once — the entry warp replaces it this session.
    try {
      sessionStorage.setItem('brain.booted.v1', '1');
    } catch {
      /* ignore */
    }
    setEntering(true);
    window.setTimeout(() => {
      window.location.href = GOOGLE_SIGN_IN_URL;
    }, 1250);
  }

  function scrollToHow() {
    document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div className="dark min-h-screen bg-[#05060d] text-white">
      {/* Nav */}
      <header className="fixed inset-x-0 top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Company Brain"
              width={32}
              height={32}
              className="drop-shadow-[0_0_12px_rgba(91,124,255,0.6)]"
            />
            <span className="font-semibold tracking-tight">Company Brain</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/login"
              className="rounded-full px-4 py-2 text-sm text-white/70 transition-colors hover:text-white"
            >
              Sign in
            </a>
            <button
              onClick={getStarted}
              data-magnetic
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#05060d] transition-transform hover:scale-105"
            >
              Get started
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-screen items-center overflow-hidden">
        <Image
          src="/banner.png"
          alt=""
          fill
          priority
          className="object-cover object-right opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#05060d] via-[#05060d]/85 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05060d] via-transparent to-transparent" />

        <div className="relative mx-auto w-full max-w-6xl px-5">
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
            Introducing Company Brain
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
            className="max-w-2xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl"
          >
            The living memory of{' '}
            <span className="bg-gradient-to-r from-blue-300 to-indigo-300 bg-clip-text text-transparent">
              your company
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.16, ease: EASE }}
            className="mt-6 max-w-xl text-lg text-white/60"
          >
            Every document, email, meeting and decision — connected, understood, and one question
            away. Your company&apos;s intelligence, alive.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24, ease: EASE }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <button
              onClick={getStarted}
              data-magnetic
              className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-3.5 text-sm font-medium shadow-[0_10px_40px_-10px_rgba(59,130,246,0.7)] transition-transform hover:scale-105"
            >
              Get started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={scrollToHow}
              className="rounded-full border border-white/15 px-6 py-3.5 text-sm text-white/80 transition-colors hover:bg-white/5"
            >
              See how it works
            </button>
          </motion.div>
        </div>

        <button
          onClick={scrollToHow}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-xs text-white/40 transition-colors hover:text-white/70"
        >
          <motion.span
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className="inline-block"
          >
            Scroll ↓
          </motion.span>
        </button>
      </section>

      {/* The cinematic story: chaos → search → graph → understanding →
          memory → action → ecosystem → trust → proof → pricing → conversion */}
      <KnowledgeScatter />
      <SearchExperience />
      <KnowledgeGraph />
      <AIReasoning />
      <MemoryTimeline />
      <Actions />
      <Integrations />
      <Enterprise />
      <Testimonials />
      <FinalCTA onGetStarted={getStarted} />
      <Footer />

      {/* Entry warp → product */}
      <AnimatePresence>
        {entering && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#04040a]"
          >
            <NeuralField className="absolute inset-0 h-full w-full opacity-60" variant="hero" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: [0.9, 1, 1.35], opacity: [0, 1, 1] }}
              transition={{ duration: 1.25, ease: EASE, times: [0, 0.35, 1] }}
              className="relative flex flex-col items-center"
            >
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 shadow-[0_0_50px_rgba(59,130,246,0.7)]">
                <Sparkles className="h-7 w-7" />
              </span>
              <p className="mt-5 text-sm text-white/70">Entering your Company Brain…</p>
            </motion.div>
            <motion.div
              className="absolute inset-0 bg-white"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0, 0.95] }}
              transition={{ duration: 1.25, times: [0, 0.72, 1] }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
