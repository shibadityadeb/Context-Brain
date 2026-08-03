'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  CalendarClock,
  FileText,
  Link as LinkIcon,
  Radio,
  Sparkles,
  Users,
} from 'lucide-react';
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

/** Friendly display name for a synced calendar account (email local-part). */
function accountName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
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
      {meeting.accounts.length > 0 && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          From {meeting.accounts.map(accountName).join(', ')}
        </p>
      )}
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
  const [joinUrl, setJoinUrl] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinNote, setJoinNote] = useState<string | null>(null);

  const load = useCallback(() => {
    meetingsApi
      .list({ limit: 100 })
      .then(setMeetings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load meetings'));
  }, []);

  async function sendBot(e: React.FormEvent) {
    e.preventDefault();
    const url = joinUrl.trim();
    if (!url || joining) return;
    setJoining(true);
    setJoinNote(null);
    try {
      await meetingsApi.join(url);
      setJoinUrl('');
      setJoinNote('Bot is joining — it will appear below and start capturing.');
      load();
    } catch (err) {
      setJoinNote(err instanceof Error ? err.message : 'Could not send the bot.');
    } finally {
      setJoining(false);
    }
  }

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

      {/* Ad-hoc: paste a Meet link and send the notetaker bot in now. */}
      <form
        onSubmit={sendBot}
        className="flex flex-col gap-2 rounded-xl border bg-card/40 p-3 sm:flex-row sm:items-center"
      >
        <div className="flex flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 focus-within:border-ai/40">
          <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={joinUrl}
            onChange={(e) => setJoinUrl(e.target.value)}
            placeholder="Paste a Google Meet link to send the notetaker bot…"
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={joining || joinUrl.trim().length < 8}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ai-gradient px-3.5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          <Bot className="h-4 w-4" />
          {joining ? 'Sending…' : 'Send bot'}
        </button>
      </form>
      {joinNote && <p className="text-xs text-muted-foreground">{joinNote}</p>}

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
