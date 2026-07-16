'use client';

import { FolderKanban } from 'lucide-react';
import { KnowledgeCollection } from '@/components/collections/knowledge-collection';

export default function ProjectsPage() {
  return (
    <KnowledgeCollection
      types={['PROJECT', 'FEATURE', 'MILESTONE', 'REQUIREMENT']}
      title="Projects"
      description="Initiatives, features and milestones your company is working toward."
      icon={FolderKanban}
      emptyTitle="No projects yet"
      emptyDescription="Projects and features are recognized from your documents and discussions automatically."
    />
  );
}
