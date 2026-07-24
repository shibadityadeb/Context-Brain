import {
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  FolderCog,
  Globe,
  HelpCircle,
  Loader2,
  Mail,
  PencilRuler,
  Send,
  ShieldQuestion,
  Sparkles,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ActionStatus, ActionStepStatus } from '@/lib/api';

type Tone = 'neutral' | 'ai' | 'success' | 'warning' | 'danger';

interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** Whether this is a non-terminal state worth polling for. */
  live: boolean;
}

export const ACTION_STATUS: Record<ActionStatus, StatusMeta> = {
  PLANNING: { label: 'Planning', tone: 'ai', icon: Sparkles, live: true },
  NEEDS_INPUT: { label: 'Needs input', tone: 'warning', icon: HelpCircle, live: false },
  PENDING_APPROVAL: {
    label: 'Pending approval',
    tone: 'warning',
    icon: ShieldQuestion,
    live: false,
  },
  APPROVED: { label: 'Approved', tone: 'ai', icon: CheckCircle2, live: true },
  RUNNING: { label: 'Running', tone: 'ai', icon: Loader2, live: true },
  COMPLETED: { label: 'Completed', tone: 'success', icon: CheckCircle2, live: false },
  FAILED: { label: 'Failed', tone: 'danger', icon: XCircle, live: false },
  REJECTED: { label: 'Rejected', tone: 'neutral', icon: Ban, live: false },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: Ban, live: false },
};

export const STEP_STATUS: Record<ActionStepStatus, StatusMeta> = {
  PENDING: { label: 'Pending', tone: 'neutral', icon: CircleDashed, live: false },
  RUNNING: { label: 'Running', tone: 'ai', icon: Loader2, live: true },
  COMPLETED: { label: 'Done', tone: 'success', icon: CheckCircle2, live: false },
  FAILED: { label: 'Failed', tone: 'danger', icon: XCircle, live: false },
  SKIPPED: { label: 'Skipped', tone: 'neutral', icon: Ban, live: false },
};

/** Icon for an action type (falls back to a generic bolt). */
export function typeIcon(type: string): LucideIcon {
  const map: Record<string, LucideIcon> = {
    CALENDAR_MANAGEMENT: CalendarClock,
    MEETING_SCHEDULE: CalendarClock,
    EMAIL_DRAFT: Mail,
    EMAIL_SEND: Send,
    WEB_RESEARCH: Globe,
    BROWSER_AUTOMATION: Globe,
    FORM_FILLING: PencilRuler,
    FILE_MANAGEMENT: FolderCog,
    DOCUMENT_GENERATION: FileText,
    TASK_CREATION: CheckCircle2,
    FOLLOW_UP_REMINDER: Clock,
  };
  return map[type] ?? Zap;
}

/** Human label for an action type ("EMAIL_DRAFT" → "Email draft"). */
export function typeLabel(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .join(' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function isLive(status: ActionStatus): boolean {
  return ACTION_STATUS[status]?.live ?? false;
}
