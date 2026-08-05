'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarClock, FileText } from 'lucide-react';
import {
  api,
  meetingsApi,
  peopleApi,
  type KnowledgeDocument,
  type Meeting,
  type PersonListItem,
} from '@/lib/api';

/** A short source label derived from the document's mime type. */
function docSource(doc: KnowledgeDocument): string {
  const m = doc.mimeType.toLowerCase();
  if (m.includes('presentation') || m.includes('slides')) return 'Slides';
  if (m.includes('spreadsheet') || m.includes('sheet') || m.includes('csv')) return 'Sheets';
  if (m.includes('pdf')) return 'PDF';
  if (m.includes('word') || m.includes('document')) return 'Doc';
  if (m.includes('markdown') || m.includes('text')) return 'Text';
  return 'Document';
}

function fmtDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
}

function durationMin(m: Meeting): number | null {
  if (!m.startsAt || !m.endsAt) return null;
  return Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60000);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function AskRail() {
  const [docs, setDocs] = useState<KnowledgeDocument[] | null>(null);
  const [docTotal, setDocTotal] = useState(0);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [people, setPeople] = useState<PersonListItem[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      api.listDocuments({ limit: 5 }),
      meetingsApi.list({ limit: 20 }),
      peopleApi.list(),
    ]).then(([d, m, p]) => {
      if (!live) return;
      if (d.status === 'fulfilled') {
        setDocs(d.value.items);
        setDocTotal(d.value.total);
      } else {
        setDocs([]);
      }
      if (m.status === 'fulfilled') {
        setMeetings(
          [...m.value]
            .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''))
            .slice(0, 3),
        );
      }
      if (p.status === 'fulfilled') setPeople(p.value.people.slice(0, 8));
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pr-1"
      data-lenis-prevent
    >
      {/* Context used */}
      {docs && docs.length > 0 && (
        <section className="rounded-2xl border bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Context used</h2>
            <span className="text-xs text-muted-foreground">{docTotal} sources</span>
          </div>
          <div className="space-y-2">
            {docs.map((d) => (
              <Link
                key={d.id}
                href={`/documents?doc=${d.id}`}
                className="flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 transition-colors hover:border-ai/40"
              >
                <FileText className="h-4 w-4 shrink-0 text-ai" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{d.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {docSource(d)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          {docTotal > docs.length && (
            <Link href="/documents" className="mt-2 inline-block text-xs text-ai hover:underline">
              + {docTotal - docs.length} more sources
            </Link>
          )}
        </section>
      )}

      {/* Related meetings */}
      {meetings.length > 0 && (
        <section className="rounded-2xl border bg-card/40 p-4">
          <h2 className="mb-3 text-sm font-semibold">Related meetings</h2>
          <div className="space-y-2">
            {meetings.map((m) => {
              const mins = durationMin(m);
              return (
                <Link
                  key={m.id}
                  href={`/meetings?m=${m.id}`}
                  className="flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 transition-colors hover:border-ai/40"
                >
                  <CalendarClock className="h-4 w-4 shrink-0 text-ai" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{m.title ?? 'Untitled meeting'}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {fmtDate(m.startsAt)}
                      {mins ? ` · ${mins} min` : ''}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
          <Link href="/meetings" className="mt-2 inline-block text-xs text-ai hover:underline">
            View all
          </Link>
        </section>
      )}

      {/* People involved */}
      {people.length > 0 && (
        <section className="rounded-2xl border bg-card/40 p-4">
          <h2 className="mb-3 text-sm font-semibold">People involved</h2>
          <div className="flex items-center">
            {people.slice(0, 5).map((p, i) => (
              <Link
                key={p.id}
                href={`/people/${p.id}`}
                title={p.name}
                style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
                className="grid h-9 w-9 place-items-center rounded-full border-2 border-background bg-ai/15 text-xs font-semibold text-ai transition-transform hover:-translate-y-0.5"
              >
                {initials(p.name)}
              </Link>
            ))}
            {people.length > 5 && (
              <span
                style={{ marginLeft: -8 }}
                className="grid h-9 w-9 place-items-center rounded-full border-2 border-background bg-muted text-[11px] font-medium text-muted-foreground"
              >
                +{people.length - 5}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
