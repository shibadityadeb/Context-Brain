'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowUpRight, Boxes, Cable, FileText, History, Sparkles, Upload } from 'lucide-react';
import {
  api,
  knowledgeGraphApi,
  memoryApi,
  type ChangesResponse,
  type KnowledgeDocument,
  type KnowledgeObjectSummary,
  type MemoryStats,
} from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { EntityCard } from '@/components/cards/entity-card';
import { SkeletonCard, Kbd } from '@/components/ui/primitives';
import { NeuralField } from '@/components/brain/neural-field';
import { OrbitField } from '@/components/brain/orbit-field';
import { changeTypeLabel } from '@/components/memory/util';
import { fadeUp, staggerContainer } from '@/lib/motion';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <motion.div variants={fadeUp} className="rounded-xl border bg-card p-4">
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </motion.div>
  );
}

const QUICK = [
  { href: '/knowledge/upload', label: 'Upload a document', icon: Upload },
  { href: '/connectors', label: 'Connect a workspace', icon: Cable },
  { href: '/people', label: 'Browse people', icon: Boxes },
  { href: '/memory/changes', label: 'See what changed', icon: History },
];

export default function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [recent, setRecent] = useState<KnowledgeObjectSummary[] | null>(null);
  const [changes, setChanges] = useState<ChangesResponse | null>(null);
  const [docs, setDocs] = useState<KnowledgeDocument[] | null>(null);

  useEffect(() => {
    memoryApi
      .getStats()
      .then(setStats)
      .catch(() => setStats(null));
    knowledgeGraphApi
      .listObjects({ pageSize: 6 })
      .then((d) => setRecent(d.objects))
      .catch(() => setRecent([]));
    memoryApi
      .getChanges({ since: new Date(Date.now() - 7 * 864e5).toISOString(), limit: 6 })
      .then(setChanges)
      .catch(() => setChanges(null));
    api
      .listDocuments({ limit: 5 })
      .then((d) => setDocs(d.items))
      .catch(() => setDocs([]));
  }, []);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/ask?q=${encodeURIComponent(q)}` : '/ask');
  }

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-10">
      {/* Living command center */}
      <motion.section
        variants={fadeUp}
        className="relative overflow-hidden rounded-2xl border bg-card/30"
      >
        <NeuralField
          className="absolute inset-0 h-full w-full opacity-50"
          variant="hero"
          interactive
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 80% at 50% 45%, hsl(var(--ai) / 0.16), transparent 70%)',
          }}
        />
        <OrbitField entities={recent ?? []} />

        <div className="relative flex min-h-[440px] flex-col items-center justify-center px-6 py-16 text-center">
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-5 inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai" />
            {greeting()}, {firstName} · your company is thinking
          </motion.span>

          <h1 className="max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            What do you want to <span className="text-gradient">know?</span>
          </h1>

          <form onSubmit={ask} className="mt-7 w-full max-w-xl">
            <div className="group flex items-center gap-3 rounded-2xl border bg-background/80 px-4 py-3.5 shadow-elevation-mid backdrop-blur-xl transition-all focus-within:border-ai/50 focus-within:shadow-glow">
              <Sparkles className="h-5 w-5 shrink-0 text-ai" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ask your Company Brain anything…"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                data-magnetic
              />
              <button
                type="submit"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ai-gradient text-white transition-transform hover:scale-110 active:scale-95"
                aria-label="Ask"
                data-magnetic
              >
                <ArrowUpRight className="h-5 w-5" />
              </button>
            </div>
          </form>

          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> to search everything
          </p>
        </div>
      </motion.section>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Facts remembered" value={stats?.totalActive ?? '—'} />
        <Stat label="Timeline events" value={stats?.timelineGrowth.events ?? '—'} />
        <Stat label="Learned this week" value={changes?.total ?? '—'} />
        <Stat
          label="Avg. confidence"
          value={stats ? `${Math.round(stats.avgConfidence * 100)}%` : '—'}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        {/* Recently learned */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Recently learned</h2>
            <Link href="/brain" className="text-sm text-muted-foreground hover:text-foreground">
              View all →
            </Link>
          </div>
          {!recent ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nothing learned yet. Upload a document or connect a workspace to get started.
            </p>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="grid gap-3 sm:grid-cols-2"
            >
              {recent.map((e) => (
                <EntityCard key={e.id} entity={e} />
              ))}
            </motion.div>
          )}
        </section>

        {/* Side column */}
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-lg font-semibold tracking-tight">What changed</h2>
            <div className="space-y-1">
              {changes?.changes.length ? (
                changes.changes.map((c) => (
                  <Link
                    key={`${c.memoryId}-${c.version}`}
                    href={`/memory/${c.memoryId}`}
                    className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ai" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.subject ?? 'Memory'}</p>
                      <p className="text-xs text-muted-foreground">
                        {changeTypeLabel(c.changeType)} · {new Date(c.at).toLocaleDateString()}
                      </p>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="px-2 text-sm text-muted-foreground">No recent changes.</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Latest documents</h2>
            <div className="space-y-1">
              {docs?.length ? (
                docs.map((d) => (
                  <Link
                    key={d.id}
                    href={`/knowledge/documents/${d.id}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">{d.title}</span>
                  </Link>
                ))
              ) : (
                <p className="px-2 text-sm text-muted-foreground">No documents yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Suggested actions */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-ai/30 hover:shadow-elevation-mid"
            >
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-ai/10 text-ai">
                <a.icon className="h-4.5 w-4.5" />
              </span>
              <span className="text-sm font-medium">{a.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </motion.div>
  );
}
