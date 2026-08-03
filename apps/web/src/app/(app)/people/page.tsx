'use client';

import { Users } from 'lucide-react';
import { KnowledgeCollection } from '@/components/collections/knowledge-collection';

export default function PeoplePage() {
  return (
    <KnowledgeCollection
      types={['PERSON', 'TEAM']}
      title="People"
      description="Your team — the people on your company domain."
      icon={Users}
      internalOnly
      emptyTitle="No team members yet"
      emptyDescription="People on your company domain appear here as they show up in synced mail, calendar and documents."
    />
  );
}
