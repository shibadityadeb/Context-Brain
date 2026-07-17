'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckSquare, Gavel, Layers, Radio, Sparkles } from 'lucide-react';
import { Button } from '@company-brain/ui';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { meetingApi, meetingLiveUrl, type MeetingLiveEvent } from '@/lib/api';

interface TranscriptLine {
  id: string;
  index: number;
  startMs: number;
  text: string;
}
interface Item {
  id: string;
  title: string;
  meta?: string;
}

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export default function MeetingLivePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [status, setStatus] = useState<string>('…');
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [decisions, setDecisions] = useState<Item[]>([]);
  const [tasks, setTasks] = useState<Item[]>([]);
  const [topics, setTopics] = useState<Item[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [summary, setSummary] = useState<{
    executive: string;
    keyPoints: Array<{ text: string }>;
  } | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const mergeById = (prev: Item[], next: Item): Item[] =>
    prev.some((p) => p.id === next.id) ? prev : [...prev, next];

  const handleEvent = useCallback((event: MeetingLiveEvent) => {
    const d = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'transcript':
        setTranscript((prev) => {
          if (prev.some((l) => l.id === d.id)) return prev;
          return [
            ...prev,
            {
              id: String(d.id),
              index: Number(d.index),
              startMs: Number(d.startMs),
              text: String(d.text),
            },
          ].sort((a, b) => a.index - b.index);
        });
        break;
      case 'decision':
        setDecisions((prev) =>
          mergeById(prev, {
            id: String(d.id),
            title: String(d.title),
            meta: d.owner ? `Owner: ${String(d.owner)}` : undefined,
          }),
        );
        break;
      case 'task':
        setTasks((prev) =>
          mergeById(prev, {
            id: String(d.id),
            title: String(d.title),
            meta: d.owner ? `Owner: ${String(d.owner)}` : undefined,
          }),
        );
        break;
      case 'topic':
        setTopics((prev) =>
          mergeById(prev, {
            id: String(d.id),
            title: String(d.title),
            meta: d.kind ? String(d.kind) : undefined,
          }),
        );
        break;
      case 'memory':
        if (typeof d.memoryCount === 'number') setMemoryCount(d.memoryCount);
        break;
      case 'summary':
        setSummary({
          executive: String(d.executive ?? ''),
          keyPoints: Array.isArray(d.keyPoints) ? (d.keyPoints as Array<{ text: string }>) : [],
        });
        break;
      case 'status':
        if (typeof d.status === 'string') setStatus(d.status);
        break;
      default:
        break;
    }
  }, []);

  // Seed from the REST snapshot so a mid-meeting open isn't blank.
  useEffect(() => {
    meetingApi
      .get(id)
      .then((m) => {
        setStatus(m.status);
        setMemoryCount(m.memoryCount);
        setTranscript(
          m.transcriptChunks.map((c) => ({
            id: c.id,
            index: c.index,
            startMs: c.startMs,
            text: c.text,
          })),
        );
        setDecisions(
          m.decisions.map((x) => ({
            id: x.id,
            title: x.title,
            meta: x.owner ? `Owner: ${x.owner}` : undefined,
          })),
        );
        setTasks(
          m.tasks.map((x) => ({
            id: x.id,
            title: x.title,
            meta: x.owner ? `Owner: ${x.owner}` : undefined,
          })),
        );
        setTopics(m.topics.map((x) => ({ id: x.id, title: x.title, meta: x.kind })));
        if (m.summary)
          setSummary({ executive: m.summary.executive, keyPoints: m.summary.keyPoints ?? [] });
      })
      .catch(() => undefined);
  }, [id]);

  // Live WebSocket feed.
  useEffect(() => {
    const url = meetingLiveUrl(id);
    if (!url) return;
    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      socket = new WebSocket(url);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (msg) => {
        try {
          handleEvent(JSON.parse(msg.data as string) as MeetingLiveEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [id, handleEvent]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length]);

  async function leave() {
    await meetingApi.leave(id).catch(() => undefined);
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/meetings/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Meeting
      </Link>

      <PageHeader
        title="Live meeting"
        description="Transcribing locally and extracting knowledge in real time."
        action={
          <div className="flex items-center gap-2">
            <Badge tone={connected ? 'ai' : 'warning'}>
              <Radio className={`h-3 w-3 ${connected ? 'animate-pulse' : ''}`} />{' '}
              {connected ? 'Live' : 'Reconnecting'}
            </Badge>
            <Badge tone="neutral">{status}</Badge>
            <Button variant="outline" onClick={() => void leave()}>
              Stop capture
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Decisions', decisions.length],
          ['Tasks', tasks.length],
          ['Topics', topics.length],
          ['Memories', memoryCount],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Live transcript */}
        <section className="rounded-xl border p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4 text-ai" />
            <h2 className="text-sm font-semibold">Live transcript</h2>
          </div>
          <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-2">
            {transcript.length === 0 && (
              <p className="text-sm text-muted-foreground">Waiting for the first words…</p>
            )}
            {transcript.map((l) => (
              <div key={l.id} className="flex gap-3 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  {fmtTime(l.startMs)}
                </span>
                <p className="leading-relaxed">{l.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        {/* Live extraction */}
        <div className="space-y-4">
          {summary && (
            <section className="rounded-xl border p-5">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-ai" />
                <h2 className="text-sm font-semibold">Live summary</h2>
              </div>
              <p className="text-sm leading-relaxed">{summary.executive}</p>
            </section>
          )}

          <section className="rounded-xl border p-5">
            <div className="mb-2 flex items-center gap-2">
              <Gavel className="h-4 w-4 text-ai" />
              <h2 className="text-sm font-semibold">Decisions</h2>
            </div>
            <ul className="space-y-1.5 text-sm">
              {decisions.map((d) => (
                <li key={d.id}>
                  • {d.title}
                  {d.meta && <span className="text-xs text-muted-foreground"> — {d.meta}</span>}
                </li>
              ))}
              {decisions.length === 0 && <li className="text-muted-foreground">None yet.</li>}
            </ul>
          </section>

          <section className="rounded-xl border p-5">
            <div className="mb-2 flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-ai" />
              <h2 className="text-sm font-semibold">Action items</h2>
            </div>
            <ul className="space-y-1.5 text-sm">
              {tasks.map((t) => (
                <li key={t.id}>
                  • {t.title}
                  {t.meta && <span className="text-xs text-muted-foreground"> — {t.meta}</span>}
                </li>
              ))}
              {tasks.length === 0 && <li className="text-muted-foreground">None yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
