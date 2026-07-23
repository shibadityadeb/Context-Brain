'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  CheckSquare,
  FileText,
  Gavel,
  Hash,
  Radio,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import { Badge, PageHeader } from '@/components/ui/primitives';
import {
  meetingsApi,
  type MeetingDetailView,
  type MeetingLifecycle,
  type RecallAnalysisStatus,
  type RecallSimpleStatus,
  type RecallTranscript,
} from '@/lib/api';

const LIVE_STATUSES = new Set<MeetingLifecycle>(['joining', 'recording']);
// Analysis is still in flight while a fresh transcript is being processed.
const ANALYSIS_PENDING = new Set<RecallAnalysisStatus>(['pending', 'processing']);

/** Human labels for the canonical lifecycle. */
const STATUS_LABELS: Record<MeetingLifecycle, string> = {
  upcoming: 'Upcoming',
  bot_scheduled: 'Bot Scheduled',
  joining: 'Joining',
  recording: 'Recording',
  processing_transcript: 'Processing Transcript',
  analysis_complete: 'Analysis Complete',
  completed: 'Completed',
  failed: 'Failed',
};

/** Decode a route param that may or may not still be percent-encoded. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function meetingTone(status: MeetingLifecycle): 'neutral' | 'ai' | 'success' | 'danger' {
  if (LIVE_STATUSES.has(status)) return 'ai';
  if (status === 'analysis_complete' || status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function simpleTone(status: RecallSimpleStatus): 'neutral' | 'success' | 'danger' {
  if (status === 'done') return 'success';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Users;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-ai" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && <span className="text-xs text-muted-foreground">({count})</span>}
      </div>
      {children}
    </section>
  );
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  // The canonical id (a calendar event id) can contain `@` and `:`, so the list
  // link percent-encodes it. Next may hand it back still-encoded; normalize to
  // the raw id here and let the API client encode it exactly once.
  const id = safeDecode(params.id);
  const [detail, setDetail] = useState<MeetingDetailView | null>(null);
  const [transcript, setTranscript] = useState<RecallTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    meetingsApi
      .get(id)
      .then((d) => {
        setDetail(d);
        // Pull the full transcript once it exists, for the reader below.
        if (d.transcript && d.transcript.segmentCount > 0) {
          meetingsApi
            .transcript(id)
            .then(setTranscript)
            .catch(() => {
              /* transcript endpoint 404s until ready — ignore */
            });
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load meeting'));
  }, [id]);

  useEffect(() => {
    load();
    // Poll while things are still processing so recording/transcript/analysis
    // statuses advance without a manual refresh.
    const timer = setInterval(load, 8_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail) return <p className="text-sm text-muted-foreground">Loading meeting…</p>;

  const { meeting, participants, recordings, analysis } = detail;
  const live = LIVE_STATUSES.has(meeting.status);
  const recording = recordings[0] ?? null;
  const when = meeting.startsAt ?? meeting.createdAt;
  const transcriptStatus = detail.transcript?.status ?? 'pending';

  const header = (
    <>
      <Link
        href="/meetings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Meetings
      </Link>

      <PageHeader
        title={meeting.title ?? 'Meeting'}
        description={`${new Date(when).toLocaleString()}${
          meeting.platform ? ` · ${meeting.platform.replace('_', ' ')}` : ''
        }`}
        action={
          <div className="flex items-center gap-2">
            {live && <Radio className="h-4 w-4 animate-pulse text-ai" />}
            <Badge tone={meetingTone(meeting.status)} className="uppercase">
              {STATUS_LABELS[meeting.status]}
            </Badge>
          </div>
        }
      />
    </>
  );

  // No capture provider attached yet — the meeting is on the calendar but the
  // notetaker hasn't been booked. Show the meeting and what happens next.
  if (!meeting.captured) {
    return (
      <div className="space-y-6">
        {header}
        <Section icon={CalendarClock} title="Notetaker">
          <p className="text-sm text-muted-foreground">
            {meeting.hint ?? 'Bot will be scheduled automatically before the meeting.'}
          </p>
          {meeting.meetingUrl && (
            <a
              href={meeting.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-ai hover:underline"
            >
              <Video className="h-4 w-4" /> Join the Google Meet
            </a>
          )}
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {/* Pipeline status */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatusTile
          icon={Video}
          label="Recording"
          value={recording ? recording.status : 'pending'}
          tone={recording ? simpleTone(recording.status) : 'neutral'}
        />
        <StatusTile
          icon={FileText}
          label="Transcript"
          value={transcriptStatus}
          tone={simpleTone(transcriptStatus)}
        />
        <StatusTile
          icon={Sparkles}
          label="Analysis"
          value={analysis ? analysis.status : 'pending'}
          tone={
            analysis?.status === 'done'
              ? 'success'
              : analysis?.status === 'failed'
                ? 'danger'
                : 'neutral'
          }
        />
        <StatusTile icon={Users} label="Participants" value={String(participants.length)} />
      </div>

      {/* Codex analysis */}
      <Section icon={Sparkles} title="Codex analysis">
        {!analysis || ANALYSIS_PENDING.has(analysis.status) ? (
          <p className="text-sm text-muted-foreground">
            {transcriptStatus === 'done'
              ? 'Analyzing the transcript — summary, action items, decisions and key topics will appear here shortly.'
              : 'Waiting for the transcript. Analysis runs automatically once transcription completes.'}
          </p>
        ) : analysis.status === 'failed' ? (
          <p className="text-sm text-destructive">
            Analysis failed{analysis.error ? `: ${analysis.error}` : '.'}
          </p>
        ) : (
          <div className="space-y-5">
            {analysis.summary && <p className="text-sm leading-relaxed">{analysis.summary}</p>}

            {analysis.topics.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {analysis.topics.map((t, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    <Hash className="h-3 w-3" />
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-ai" />
                  <h3 className="text-sm font-semibold">Action items</h3>
                  <span className="text-xs text-muted-foreground">
                    ({analysis.actionItems.length})
                  </span>
                </div>
                <ul className="space-y-2">
                  {analysis.actionItems.map((a, i) => (
                    <li key={i} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{a.title}</p>
                      {a.owner && (
                        <p className="mt-1 text-xs text-muted-foreground">Owner: {a.owner}</p>
                      )}
                    </li>
                  ))}
                  {analysis.actionItems.length === 0 && (
                    <p className="text-sm text-muted-foreground">No action items.</p>
                  )}
                </ul>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Gavel className="h-4 w-4 text-ai" />
                  <h3 className="text-sm font-semibold">Decisions</h3>
                  <span className="text-xs text-muted-foreground">
                    ({analysis.decisions.length})
                  </span>
                </div>
                <ul className="space-y-2">
                  {analysis.decisions.map((d, i) => (
                    <li key={i} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{d.decision}</p>
                      {d.detail && <p className="mt-0.5 text-muted-foreground">{d.detail}</p>}
                    </li>
                  ))}
                  {analysis.decisions.length === 0 && (
                    <p className="text-sm text-muted-foreground">No decisions.</p>
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Participants */}
      <Section icon={Users} title="Participants" count={participants.length}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <span className="font-medium">{p.name}</span>
              {p.isHost && (
                <Badge tone="neutral" className="ml-auto">
                  Host
                </Badge>
              )}
            </li>
          ))}
          {participants.length === 0 && (
            <p className="text-sm text-muted-foreground">No participants recorded.</p>
          )}
        </ul>
      </Section>

      {/* Transcript */}
      <Section icon={FileText} title="Transcript" count={detail.transcript?.segmentCount ?? 0}>
        {!transcript || transcript.segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {transcriptStatus === 'failed'
              ? 'Transcription failed for this meeting.'
              : 'No transcript yet. It appears here once the meeting is transcribed.'}
          </p>
        ) : (
          <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-2">
            {transcript.segments.map((s) => (
              <div key={s.index} className="flex gap-3 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  {fmtTime(s.startMs)}
                </span>
                <p className="leading-relaxed">
                  {s.speaker && <span className="font-medium">{s.speaker}: </span>}
                  {s.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'danger' | 'ai';
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <Badge tone={tone} className="mt-2 uppercase">
        {value}
      </Badge>
    </div>
  );
}
