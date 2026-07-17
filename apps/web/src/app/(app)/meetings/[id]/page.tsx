'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckSquare, Gavel, Layers, Radio, Users } from 'lucide-react';
import { Button } from '@company-brain/ui';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { meetingApi, type MeetingDetail } from '@/lib/api';

const LIVE_STATUSES = new Set(['JOINING', 'WAITING', 'LIVE', 'PROCESSING']);

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Users;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-ai" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      {children}
    </section>
  );
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    meetingApi
      .get(id)
      .then(setMeeting)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load meeting'));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function join() {
    setBusy(true);
    try {
      await meetingApi.join(id);
      setTimeout(load, 1500);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!meeting) return <p className="text-sm text-muted-foreground">Loading meeting…</p>;

  const live = LIVE_STATUSES.has(meeting.status);
  const knowledgeCount = meeting.decisions.length + meeting.tasks.length + meeting.topics.length;

  return (
    <div className="space-y-6">
      <Link
        href="/meetings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Meetings
      </Link>

      <PageHeader
        title={meeting.title}
        description={`${new Date(meeting.scheduledStart).toLocaleString()}${
          meeting.organizerEmail ? ` · ${meeting.organizerEmail}` : ''
        }`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={live ? 'ai' : meeting.status === 'COMPLETED' ? 'success' : 'neutral'}>
              {meeting.status}
            </Badge>
            {live && (
              <Link href={`/meetings/${id}/live`}>
                <Button variant="outline">
                  <Radio className="mr-2 h-4 w-4 animate-pulse" /> Watch live
                </Button>
              </Link>
            )}
            {(meeting.status === 'SCHEDULED' || meeting.status === 'MISSED') && (
              <Button onClick={() => void join()} disabled={busy}>
                {busy ? 'Joining…' : 'Join now'}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Transcript', meeting.chunkCount],
          ['Decisions', meeting.decisionCount],
          ['Tasks', meeting.taskCount],
          ['Topics', meeting.topicCount],
          ['Memories', meeting.memoryCount],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Summary */}
      {meeting.summary && (
        <section className="rounded-xl border p-5">
          <h2 className="text-sm font-semibold">Executive summary</h2>
          <p className="mt-2 text-sm leading-relaxed">{meeting.summary.executive}</p>
          {meeting.summary.keyPoints && meeting.summary.keyPoints.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {meeting.summary.keyPoints.map((k, i) => (
                <li key={i}>{k.text}</li>
              ))}
            </ul>
          )}
          {meeting.summary.detailed && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">Detailed summary</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {meeting.summary.detailed}
              </p>
            </details>
          )}
          {meeting.summary.followUps && meeting.summary.followUps.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Follow-ups
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {meeting.summary.followUps.map((f, i) => (
                  <li key={i}>
                    • {f.text}
                    {f.owner ? <span className="text-muted-foreground"> — {f.owner}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={Gavel} title="Decisions" count={meeting.decisions.length}>
          <ul className="space-y-2">
            {meeting.decisions.map((d) => (
              <li key={d.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{d.title}</p>
                {d.detail && <p className="mt-0.5 text-muted-foreground">{d.detail}</p>}
                {d.owner && <p className="mt-1 text-xs text-muted-foreground">Owner: {d.owner}</p>}
              </li>
            ))}
            {meeting.decisions.length === 0 && (
              <p className="text-sm text-muted-foreground">No decisions extracted.</p>
            )}
          </ul>
        </Section>

        <Section icon={CheckSquare} title="Tasks" count={meeting.tasks.length}>
          <ul className="space-y-2">
            {meeting.tasks.map((t) => (
              <li key={t.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  {t.priority !== 'NONE' && (
                    <Badge
                      tone={
                        t.priority === 'CRITICAL' || t.priority === 'HIGH' ? 'danger' : 'neutral'
                      }
                    >
                      {t.priority}
                    </Badge>
                  )}
                </div>
                {t.owner && <p className="mt-1 text-xs text-muted-foreground">Owner: {t.owner}</p>}
                {t.dueDate && (
                  <p className="text-xs text-muted-foreground">
                    Due {new Date(t.dueDate).toLocaleDateString()}
                  </p>
                )}
              </li>
            ))}
            {meeting.tasks.length === 0 && (
              <p className="text-sm text-muted-foreground">No tasks extracted.</p>
            )}
          </ul>
        </Section>

        <Section icon={Layers} title="Topics & threads" count={meeting.topics.length}>
          <ul className="space-y-2">
            {meeting.topics.map((t) => (
              <li key={t.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{t.kind}</Badge>
                  <span className="font-medium">{t.title}</span>
                </div>
                {t.summary && <p className="mt-0.5 text-muted-foreground">{t.summary}</p>}
              </li>
            ))}
            {meeting.topics.length === 0 && (
              <p className="text-sm text-muted-foreground">No topics extracted.</p>
            )}
          </ul>
        </Section>

        <Section icon={Users} title="Participants" count={meeting.participants.length}>
          <ul className="space-y-2">
            {meeting.participants.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <span className="font-medium">{p.displayName}</span>
                {p.email && <span className="text-xs text-muted-foreground">{p.email}</span>}
                <Badge tone="neutral" className="ml-auto">
                  {p.role}
                </Badge>
              </li>
            ))}
            {meeting.participants.length === 0 && (
              <p className="text-sm text-muted-foreground">No participants recorded.</p>
            )}
          </ul>
        </Section>
      </div>

      {/* Transcript */}
      <Section icon={Layers} title="Transcript" count={meeting.transcriptChunks.length}>
        {meeting.transcriptChunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transcript yet. It appears here as the meeting is captured.
          </p>
        ) : (
          <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-2">
            {meeting.transcriptChunks.map((c) => (
              <div key={c.id} className="flex gap-3 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  {fmtTime(c.startMs)}
                </span>
                <p className="leading-relaxed">{c.text}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <p className="text-xs text-muted-foreground">
        {knowledgeCount} knowledge items from this meeting flowed into the graph and company memory.
      </p>
    </div>
  );
}
