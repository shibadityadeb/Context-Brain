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
  History,
  Mail,
  Sparkles,
  Users,
  X,
  Zap,
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
    case 'action':
      return { href: `/actions?a=${s.id}`, external: false };
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
  if (kind === 'action') return <Zap className="h-3 w-3 text-ai" />;
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

/** Slash-command palette entries (ChatGPT-style `/` trigger). */
const COMMANDS = [
  {
    id: 'replay',
    label: 'Replay',
    desc: 'Reconstruct the full history behind a project, decision, person…',
    icon: History,
    recommended: true,
  },
] as const;

export function ChatPanel({
  conversation,
  messages,
  sending,
  onSend,
  onReplay,
}: {
  conversation: ConversationDetail | null;
  messages: ConversationMessage[];
  sending: boolean;
  onSend: (question: string) => void;
  onReplay: (query: string) => void;
}) {
  const [input, setInput] = useState('');
  const [armedReplay, setArmedReplay] = useState(false);
  const [activeCmd, setActiveCmd] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // The command menu opens while typing a leading "/" (and not already armed).
  const slashToken = !armedReplay && input.startsWith('/') ? input.slice(1).toLowerCase() : null;
  const menuCommands =
    slashToken === null
      ? []
      : COMMANDS.filter(
          (c) => c.id.startsWith(slashToken) || c.label.toLowerCase().startsWith(slashToken),
        );
  const menuOpen = menuCommands.length > 0;

  function pickCommand(id: string) {
    if (id === 'replay') {
      setArmedReplay(true);
      setInput('');
      setActiveCmd(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (armedReplay) {
      if (q.length < 2) return;
      onReplay(q);
      setInput('');
      setArmedReplay(false);
      return;
    }
    if (q.length < 2 || !conversation) return;
    onSend(q);
    setInput('');
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveCmd((i) => (i + 1) % menuCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveCmd((i) => (i - 1 + menuCommands.length) % menuCommands.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickCommand(menuCommands[activeCmd]!.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
      }
      return;
    }
    // Backspace on an empty armed input disarms replay.
    if (armedReplay && e.key === 'Backspace' && input.length === 0) {
      setArmedReplay(false);
    }
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

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-8 overflow-y-auto py-6"
        data-lenis-prevent
      >
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

      <form onSubmit={submit} className="relative border-t bg-background/80 pt-3 backdrop-blur">
        {/* Slash-command palette */}
        {menuOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-xl border bg-popover shadow-elevation-mid">
            <p className="border-b px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              Modes
            </p>
            {menuCommands.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setActiveCmd(i)}
                onClick={() => pickCommand(c.id)}
                className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                  i === activeCmd ? 'bg-accent' : ''
                }`}
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ai/10 text-ai">
                  <c.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    {c.recommended && (
                      <span className="rounded bg-ai/10 px-1.5 py-0.5 text-[10px] font-medium text-ai">
                        Recommended
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">{c.desc}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-2 shadow-elevation-low focus-within:border-ai/40 focus-within:shadow-glow">
          {armedReplay ? (
            <button
              type="button"
              onClick={() => setArmedReplay(false)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ai-gradient px-2.5 py-1 text-xs font-medium text-white"
              title="Cancel Replay"
            >
              <History className="h-3.5 w-3.5" /> Replay <X className="h-3 w-3 opacity-80" />
            </button>
          ) : (
            <Sparkles className="h-5 w-5 shrink-0 text-ai" />
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={
              armedReplay
                ? 'What should I replay? e.g. “Why was Project Atlas delayed?”'
                : isPersonal
                  ? 'Ask about your own knowledge…  (type / for modes)'
                  : 'Ask about the team…  (type / for modes)'
            }
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={input.trim().length < 2 || (sending && !armedReplay)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ai-gradient text-white disabled:opacity-40"
            aria-label={armedReplay ? 'Replay' : 'Send'}
          >
            {armedReplay ? <History className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
