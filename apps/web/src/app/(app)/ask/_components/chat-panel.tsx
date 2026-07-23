'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  Boxes,
  CalendarClock,
  FileText,
  Globe,
  Mail,
  Sparkles,
  Users,
} from 'lucide-react';
import { Badge, Dot } from '@/components/ui/primitives';
import { NeuralThinking } from '@/components/brain/neural-thinking';
import { entityColor } from '@/lib/entities';
import type {
  AskSource,
  ConversationDetail,
  ConversationMessage,
  ConversationScope,
} from '@/lib/api';

function sourceHref(s: AskSource): { href: string; external: boolean } | null {
  switch (s.kind) {
    case 'web':
      return s.url ? { href: s.url, external: true } : null;
    case 'memory':
      return { href: `/memory/${s.id}`, external: false };
    case 'meeting':
      return { href: `/meetings/${s.id}`, external: false };
    case 'knowledge':
    case 'document':
      return { href: `/brain/entity/${s.id}`, external: false };
    default:
      return null; // email / calendar have no standalone page
  }
}

function SourceIcon({ kind, type }: { kind: AskSource['kind']; type: string }) {
  if (kind === 'web') return <Globe className="h-3 w-3 text-ai" />;
  if (kind === 'memory') return <Boxes className="h-3 w-3 text-ai" />;
  if (kind === 'meeting') return <CalendarClock className="h-3 w-3 text-ai" />;
  if (kind === 'email') return <Mail className="h-3 w-3 text-ai" />;
  if (kind === 'calendar') return <CalendarClock className="h-3 w-3 text-ai" />;
  if (kind === 'document') return <FileText className="h-3 w-3 text-ai" />;
  return <Dot color={entityColor(type)} />;
}

function Sources({ sources }: { sources: AskSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Sources</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => {
          const target = sourceHref(s);
          const inner = (
            <>
              <SourceIcon kind={s.kind} type={s.type} />
              <span className="max-w-[180px] truncate">{s.title}</span>
            </>
          );
          const cls =
            'inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground';
          const key = `${s.kind}-${s.id}`;
          if (!target) {
            return (
              <span key={key} className={cls}>
                {inner}
              </span>
            );
          }
          const hoverCls = `${cls} transition-colors hover:border-ai/40 hover:text-foreground`;
          return target.external ? (
            <a key={key} href={target.href} target="_blank" rel="noreferrer" className={hoverCls}>
              {inner}
            </a>
          ) : (
            <Link key={key} href={target.href} className={hoverCls}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ai-gradient px-4 py-2.5 text-sm text-white">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ai/10 text-ai">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-2.5 text-[15px] leading-relaxed text-foreground/90">
          {message.content.split(/\n{2,}/).map((para, i) => (
            <motion.p key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              {para}
            </motion.p>
          ))}
        </div>
        <Sources sources={message.sources} />
      </div>
    </div>
  );
}

const SUGGESTIONS: Record<ConversationScope, string[]> = {
  personal: [
    'What did I agree to in my last meeting?',
    "What's on my calendar this week?",
    'Summarize the docs I uploaded recently',
  ],
  team: ['What changed last week?', 'Show me the open bugs', 'What did we decide about pricing?'],
};

export function ChatPanel({
  conversation,
  messages,
  sending,
  onSend,
}: {
  conversation: ConversationDetail | null;
  messages: ConversationMessage[];
  sending: boolean;
  onSend: (question: string) => void;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (q.length < 2 || !conversation) return;
    onSend(q);
    setInput('');
  }

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-ai-gradient text-white shadow-glow">
          <Sparkles className="h-6 w-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Ask your Brain</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Start a <strong>Personal</strong> chat for your own documents, email, calendar and
          meetings — or a <strong>Team</strong> chat for shared company knowledge. Pick a
          conversation on the left, or create a new one.
        </p>
      </div>
    );
  }

  const isPersonal = conversation.scope === 'personal';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b pb-3">
        <h1 className="truncate text-lg font-semibold">{conversation.title}</h1>
        <Badge tone={isPersonal ? 'neutral' : 'ai'} className="uppercase">
          {isPersonal ? (
            <span className="inline-flex items-center gap-1">Personal</span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> Team
            </span>
          )}
        </Badge>
        {conversation.scope === 'team' && conversation.creatorName && (
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
            by {conversation.creatorName}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-8 overflow-y-auto py-6">
        {messages.length === 0 && !sending ? (
          <div className="flex flex-wrap justify-center gap-2 pt-8">
            {SUGGESTIONS[conversation.scope].map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {sending && (
              <div className="flex gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ai/10 text-ai">
                  <Sparkles className="h-4 w-4" />
                </span>
                <NeuralThinking
                  label={isPersonal ? 'Reading your knowledge…' : 'Reading across the team…'}
                />
              </div>
            )}
          </>
        )}
      </div>

      <form onSubmit={submit} className="border-t bg-background/80 pt-3 backdrop-blur">
        <div className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-2 shadow-elevation-low focus-within:border-ai/40 focus-within:shadow-glow">
          <Sparkles className="h-5 w-5 shrink-0 text-ai" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isPersonal ? 'Ask about your own knowledge…' : 'Ask about the team…'}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={input.trim().length < 2 || sending}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ai-gradient text-white disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
