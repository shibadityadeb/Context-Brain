'use client';

import { motion } from 'framer-motion';
import { Check, FileLock, KeyRound, Lock, ScrollText, ShieldCheck, UserCog } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ACCENT, Eyebrow, Reveal, Section, SectionTitle, Sub, Glow } from './shared';

const CONTROLS: { icon: LucideIcon; label: string; status: string }[] = [
  { icon: Lock, label: 'End-to-end encryption', status: 'AES-256' },
  { icon: KeyRound, label: 'SSO & SAML', status: 'Enabled' },
  { icon: ShieldCheck, label: 'SOC 2 Type II', status: 'Certified' },
  { icon: UserCog, label: 'Granular permissions', status: 'RBAC' },
  { icon: ScrollText, label: 'Audit logs', status: 'Streaming' },
  { icon: FileLock, label: 'Data residency', status: 'Configurable' },
];

export function Enterprise() {
  return (
    <Section>
      <Glow
        className="left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2"
        opacity={0.08}
      />
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <Eyebrow>Enterprise trust</Eyebrow>
          <SectionTitle className="text-3xl sm:text-4xl md:text-[2.8rem]">
            Your knowledge, under your control.
          </SectionTitle>
          <Sub className="mt-5 max-w-md">
            Company Brain is built for the enterprise from the first line of code — encrypted,
            permissioned, auditable, and compliant. Your data is never used to train shared models.
          </Sub>
          <div className="mt-8 flex flex-wrap gap-2">
            {['SOC 2', 'GDPR', 'SSO', 'SAML', 'RBAC'].map((b) => (
              <span
                key={b}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60"
              >
                {b}
              </span>
            ))}
          </div>
        </Reveal>

        {/* Security dashboard illustration */}
        <Reveal delay={0.15}>
          <div className="glass rounded-3xl p-6">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="grid h-9 w-9 place-items-center rounded-xl"
                  style={{ background: `${ACCENT}1f`, color: ACCENT }}
                >
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Security & compliance</p>
                  <p className="text-xs text-white/40">All systems operational</p>
                </div>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400">
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Secure
              </span>
            </div>

            <div className="space-y-2">
              {CONTROLS.map((c, i) => (
                <motion.div
                  key={c.label}
                  initial={{ opacity: 0, x: 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
                >
                  <c.icon className="h-4 w-4 text-white/50" />
                  <span className="flex-1 text-sm text-white/80">{c.label}</span>
                  <span className="text-xs text-white/40">{c.status}</span>
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full"
                    style={{ background: `${ACCENT}22`, color: ACCENT }}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
