import type { LucideIcon } from 'lucide-react';
import {
  Bug,
  CalendarClock,
  CheckSquare,
  Circle,
  CircleDot,
  ClipboardList,
  FileText,
  Flag,
  FolderKanban,
  Gavel,
  Mail,
  Sparkles,
  User,
  Users,
} from 'lucide-react';

/**
 * Presentation layer over the Knowledge Engine's entity types. Users never
 * see raw enum names like KNOWLEDGE_OBJECT — they see People, Tasks, Meetings.
 */
interface EntityMeta {
  label: string;
  color: string;
  icon: LucideIcon;
}

const ENTITY: Record<string, EntityMeta> = {
  PERSON: { label: 'Person', color: '#6366f1', icon: User },
  TEAM: { label: 'Team', color: '#8b5cf6', icon: Users },
  ORGANIZATION: { label: 'Organization', color: '#8b5cf6', icon: Users },
  PROJECT: { label: 'Project', color: '#0ea5e9', icon: FolderKanban },
  TASK: { label: 'Task', color: '#10b981', icon: CheckSquare },
  ACTION_ITEM: { label: 'Action item', color: '#10b981', icon: CheckSquare },
  BUG: { label: 'Bug', color: '#ef4444', icon: Bug },
  ISSUE: { label: 'Issue', color: '#f97316', icon: CircleDot },
  MEETING: { label: 'Meeting', color: '#a855f7', icon: CalendarClock },
  CALENDAR_EVENT: { label: 'Event', color: '#a855f7', icon: CalendarClock },
  DECISION: { label: 'Decision', color: '#eab308', icon: Gavel },
  FEATURE: { label: 'Feature', color: '#06b6d4', icon: Sparkles },
  REQUIREMENT: { label: 'Requirement', color: '#14b8a6', icon: ClipboardList },
  MILESTONE: { label: 'Milestone', color: '#f59e0b', icon: Flag },
  DEADLINE: { label: 'Deadline', color: '#f59e0b', icon: Flag },
  EMAIL: { label: 'Email', color: '#db2777', icon: Mail },
  DOCUMENT: { label: 'Document', color: '#3b82f6', icon: FileText },
};

export function entityMeta(type: string): EntityMeta {
  return ENTITY[type] ?? { label: titleCase(type), color: '#64748b', icon: Circle };
}

export function entityLabel(type: string): string {
  return entityMeta(type).label;
}

export function entityColor(type: string): string {
  return entityMeta(type).color;
}

export function entityIcon(type: string): LucideIcon {
  return entityMeta(type).icon;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Friendly status → tone for badges. */
export function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'ai' {
  switch (status) {
    case 'RESOLVED':
    case 'COMPLETED':
    case 'DONE':
      return 'success';
    case 'BLOCKED':
    case 'CANCELLED':
      return 'danger';
    case 'IN_PROGRESS':
    case 'OPEN':
      return 'ai';
    default:
      return 'neutral';
  }
}

export function humanStatus(status: string): string {
  if (!status || status === 'UNKNOWN') return '';
  return titleCase(status);
}
