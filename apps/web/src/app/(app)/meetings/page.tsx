'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, FileText, Radio, Sparkles } from 'lucide-react';
import { Badge, EmptyState, PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { meetingsApi, type Meeting, type MeetingLifecycle } from '@/lib/api';

type View = 'upcoming' | 'live' | 'completed' | 'all';

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'live', label: 'Live' },
  { key: 'completed', label: 'Completed' },
];

const LIVE_STATUSES = new Set<MeetingLifecycle>(['joining', 'recording']);
const UPCOMING_STATUSES = new Set<MeetingLifecycle>(['upcoming', 'bot_scheduled']);
const COMPLETED_STATUSES = new Set<MeetingLifecycle>([
  'processing_transcript',
  'analysis_complete',
  'completed',
  'ended',
  'failed',
]);
/** Past meetings where a bot-joined indicator is meaningful. */
const PAST_STATUSES = new Set<MeetingLifecycle>([
  'recording',
  'processing_transcript',
  'analysis_complete',
  'completed',
  'ended',
]);

/** Human labels for the canonical lifecycle. */
const STATUS_LABELS: Record<MeetingLifecycle, string> = {
  upcoming: 'Upcoming',
  bot_scheduled: 'Bot Scheduled',
  joining: 'Joining',
  recording: 'Recording',
  processing_transcript: 'Processing Transcript',
  analysis_complete: 'Analysis Complete',
  completed: 'Completed',
  ended: 'Ended',
  failed: 'Failed',
};

function inView(status: MeetingLifecycle, view: View): boolean {
  if (view === 'all') return true;
  if (view === 'live') return LIVE_STATUSES.has(status);
  if (view === 'upcoming') return UPCOMING_STATUSES.has(status);
  return COMPLETED_STATUSES.has(status);
}

function statusTone(status: MeetingLifecycle): 'neutral' | 'ai' | 'success' | 'danger' {
  if (LIVE_STATUSES.has(status)) return 'ai';
  if (status === 'analysis_complete' || status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function MeetingCard({ meeting }: { meeting: Meeting }) {
  const live = LIVE_STATUSES.has(meeting.status);
  const when = meeting.startsAt ?? meeting.createdAt;
  return (
    <Link
      href={`/meetings/${encodeURIComponent(meeting.id)}`}
      className="block rounded-xl border p-5 transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-2">
        {live && <Radio className="h-4 w-4 animate-pulse text-ai" />}
        <span className="font-medium">{meeting.title ?? 'Meeting'}</span>
        <Badge tone={statusTone(meeting.status)} className="ml-auto uppercase">
          {STATUS_LABELS[meeting.status]}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {new Date(when).toLocaleString()}
        {meeting.platform ? ` · ${meeting.platform.replace('_', ' ')}` : ''}
      </p>
      {PAST_STATUSES.has(meeting.status) && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full ${meeting.botJoined ? 'bg-success' : 'bg-muted-foreground/50'}`}
          />
          <span className={meeting.botJoined ? 'text-success' : 'text-muted-foreground'}>
            {meeting.botJoined ? 'Notetaker bot joined' : 'Bot did not join'}
          </span>
        </p>
      )}
      {meeting.hint && <p className="mt-2 text-xs text-muted-foreground">{meeting.hint}</p>}
    </Link>
  );
}

export default function MeetingsPage() {
  const [view, setView] = useState<View>('all');
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    meetingsApi
      .list({ limit: 100 })
      .then(setMeetings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load meetings'));
  }, []);

  useEffect(() => {
    load();
    // Refresh periodically so live meetings + fresh analyses surface on their own.
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const visible = (meetings ?? []).filter((m) => inView(m.status, view));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description="Every Google Meet on your calendar shows up here. A notetaker auto-joins each one, records and transcribes it, then Codex turns the transcript into a summary, action items, decisions and key topics."
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-full border px-3 py-1 text-xs ${v.key === view ? 'bg-secondary' : ''}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {!meetings && (
        <div className="grid gap-3 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {meetings && visible.length === 0 && meetings.length === 0 && (
        <EmptyState
          icon={CalendarClock}
          title="No meetings yet"
          description="Connect your Google Calendar to get started. Google Meet events are detected automatically — a notetaker joins each one, no invites or uploads needed. Recordings, transcripts and AI analysis appear here as they complete."
        />
      )}

      {meetings && visible.length === 0 && meetings.length > 0 && (
        <EmptyState
          icon={CalendarClock}
          title="No meetings in this view"
          description="Switch tabs to see your other meetings."
        />
      )}

      {meetings && visible.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((m) => (
            <MeetingCard key={m.id} meeting={m} />
          ))}
        </div>
      )}

      {meetings && meetings.length > 0 && (
        <p className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> Transcribed by Recall.ai
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" /> Analyzed by Codex
          </span>
        </p>
      )}
    </div>
  );
}
