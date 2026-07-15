'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { knowledgeGraphApi, type TimelineEventItem } from '@/lib/api';
import { typeColor } from '@/components/knowledge/graph-view';

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'was extracted',
  UPDATED: 'was updated',
  MENTIONED: 'was mentioned',
  STATUS_CHANGED: 'changed status',
  PRIORITY_CHANGED: 'changed priority',
  ASSIGNED: 'was assigned',
  RELATIONSHIP_ADDED: 'gained a relationship',
  CONFIDENCE_CHANGED: 'changed confidence',
  MERGED: 'absorbed a duplicate',
  RESTORED: 'was restored',
  DELETED: 'was deleted',
};

export default function TimelinePage() {
  const [events, setEvents] = useState<TimelineEventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    knowledgeGraphApi
      .getTimeline({ limit: 100 })
      .then((data) => setEvents(data.events))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load timeline'));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge Timeline</h1>
        <p className="text-sm text-muted-foreground">
          Everything the organization&apos;s knowledge learned, in order
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ol className="relative ml-3 space-y-5 border-l pl-6">
        {events?.map((event) => (
          <li key={event.id} className="relative">
            <span
              className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full"
              style={{ background: event.object ? typeColor(event.object.type) : '#888' }}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              {event.object && (
                <>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    style={{ background: typeColor(event.object.type) }}
                  >
                    {event.object.type}
                  </span>
                  <Link
                    href={`/brain/entity/${event.object.id}`}
                    className="font-medium hover:underline"
                  >
                    {event.object.title}
                  </Link>
                </>
              )}
              <span className="text-muted-foreground">
                {EVENT_LABELS[event.type] ?? event.type.toLowerCase()}
              </span>
            </div>
            {event.title && <p className="mt-0.5 text-sm text-muted-foreground">{event.title}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(event.occurredAt).toLocaleString()}
              {event.actor ? ` · ${event.actor}` : ''}
            </p>
          </li>
        ))}
        {events && events.length === 0 && (
          <p className="text-sm text-muted-foreground">No timeline events yet.</p>
        )}
      </ol>
    </div>
  );
}
