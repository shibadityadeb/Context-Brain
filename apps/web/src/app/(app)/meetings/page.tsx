'use client';

import { CalendarClock } from 'lucide-react';
import { KnowledgeCollection } from '@/components/collections/knowledge-collection';

export default function MeetingsPage() {
  return (
    <KnowledgeCollection
      types={['MEETING', 'CALENDAR_EVENT']}
      title="Meetings"
      description="Conversations and calendar events, with the decisions and people they touched."
      icon={CalendarClock}
      emptyTitle="No meetings yet"
      emptyDescription="Connect your calendar or upload notes and meetings will appear here."
    />
  );
}
