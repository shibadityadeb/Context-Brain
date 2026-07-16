'use client';

import { CheckSquare } from 'lucide-react';
import { KnowledgeCollection } from '@/components/collections/knowledge-collection';

export default function TasksPage() {
  return (
    <KnowledgeCollection
      types={['TASK', 'ACTION_ITEM', 'BUG', 'ISSUE']}
      title="Tasks"
      description="Work in flight — action items, bugs and issues surfaced from across your workspace."
      icon={CheckSquare}
      emptyTitle="No tasks yet"
      emptyDescription="Tasks and action items are extracted from meetings, docs and threads as they arrive."
    />
  );
}
