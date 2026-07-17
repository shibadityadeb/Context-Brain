'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Radio, RefreshCw } from 'lucide-react';
import { Button } from '@company-brain/ui';
import { Badge, EmptyState, PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { meetingApi, type MeetingList, type MeetingRow } from '@/lib/api';

type View = 'upcoming' | 'live' | 'completed' | 'all';

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'live', label: 'Live' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const LIVE_STATUSES = new Set(['JOINING', 'WAITING', 'LIVE', 'PROCESSING']);

function statusTone(status: string): 'neutral' | 'ai' | 'success' | 'warning' | 'danger' {
  if (LIVE_STATUSES.has(status)) return 'ai';
  if (status === 'COMPLETED') return 'success';
  if (status === 'SCHEDULED') return 'neutral';
  if (status === 'FAILED') return 'danger';
  return 'warning';
}

function MeetingCard({ meeting }: { meeting: MeetingRow }) {
  const live = LIVE_STATUSES.has(meeting.status);
  const href = live ? `/meetings/${meeting.id}/live` : `/meetings/${meeting.id}`;
  return (
    <Link href={href} className="block rounded-xl border p-5 transition-colors hover:bg-accent">
      <div className="flex items-center gap-2">
        {live && <Radio className="h-4 w-4 animate-pulse text-ai" />}
        <span className="font-medium">{meeting.title}</span>
        <Badge tone={statusTone(meeting.status)} className="ml-auto">
          {meeting.status}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {new Date(meeting.scheduledStart).toLocaleString()}
        {meeting.organizerEmail ? ` · ${meeting.organizerEmail}` : ''}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{meeting.chunkCount} transcript chunks</span>
        <span>{meeting.decisionCount} decisions</span>
        <span>{meeting.taskCount} tasks</span>
        <span>{meeting.topicCount} topics</span>
        <span>{meeting.memoryCount} memories</span>
      </div>
    </Link>
  );
}

export default function MeetingsPage() {
  const [view, setView] = useState<View>('all');
  const [data, setData] = useState<MeetingList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    meetingApi
      .list({ view, limit: 50 })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load meetings'));
  }, [view]);

  useEffect(() => {
    load();
    // Refresh periodically so live meetings surface without a manual reload.
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  async function scan() {
    setScanning(true);
    setNotice(null);
    try {
      await meetingApi.scan();
      setNotice('Scanning your calendar for upcoming Meets — they will appear here shortly.');
      setTimeout(load, 2000);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description="Company Brain auto-joins your Google Meets, transcribes them locally, and turns them into decisions, tasks and memory."
        action={
          <Button variant="outline" onClick={() => void scan()} disabled={scanning}>
            <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning…' : 'Scan calendar'}
          </Button>
        }
      />

      {notice && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{notice}</p>}
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

      {!data && (
        <div className="grid gap-3 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={CalendarClock}
          title="No meetings here yet"
          description="Connect your Google Calendar, then click “Scan calendar”. Upcoming Meets are detected and joined automatically — no bot invites, no uploads."
        />
      )}

      {data && data.items.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.items.map((m) => (
            <MeetingCard key={m.id} meeting={m} />
          ))}
        </div>
      )}
    </div>
  );
}
