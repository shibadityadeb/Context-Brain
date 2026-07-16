'use client';

import { Users } from 'lucide-react';
import { KnowledgeCollection } from '@/components/collections/knowledge-collection';

export default function PeoplePage() {
  return (
    <KnowledgeCollection
      types={['PERSON', 'TEAM']}
      title="People"
      description="Everyone your company knows — teammates, customers and contacts."
      icon={Users}
      emptyTitle="No people yet"
      emptyDescription="As documents and messages are understood, the people mentioned in them appear here automatically."
    />
  );
}
