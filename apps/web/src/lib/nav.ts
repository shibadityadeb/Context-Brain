import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Boxes,
  Cable,
  CalendarClock,
  CheckSquare,
  Clock,
  FileText,
  FolderKanban,
  History,
  Home,
  Library,
  Network,
  Search,
  Settings,
  Sparkles,
  Upload,
  Users,
  Zap,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match nested routes too (e.g. /memory/entity/x highlights Memory). */
  match?: 'exact' | 'prefix';
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
  collapsible?: boolean;
}

/**
 * Product-language navigation. Users see outcomes, not implementation:
 * engineering surfaces (graph, timelines, conflicts, raw library) live under
 * "Developer tools" and are collapsed by default.
 */
export const NAV: NavGroup[] = [
  {
    items: [
      { href: '/home', label: 'Home', icon: Home },
      { href: '/ask', label: 'Ask Brain', icon: Sparkles },
      { href: '/actions', label: 'Actions', icon: Zap },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/brain', label: 'Knowledge', icon: Boxes, match: 'exact' },
      { href: '/people', label: 'People', icon: Users },
      { href: '/meetings', label: 'Meetings', icon: CalendarClock },
      { href: '/tasks', label: 'Tasks', icon: CheckSquare },
      { href: '/projects', label: 'Projects', icon: FolderKanban },
      { href: '/memory', label: 'Company Memory', icon: History, match: 'exact' },
    ],
  },
  {
    label: 'Sources',
    items: [
      { href: '/knowledge', label: 'Documents', icon: FileText, match: 'exact' },
      { href: '/connectors', label: 'Integrations', icon: Cable },
    ],
  },
  {
    label: 'Developer tools',
    collapsible: true,
    items: [
      { href: '/brain/graph', label: 'Knowledge graph', icon: Network },
      { href: '/brain/timeline', label: 'Activity timeline', icon: Clock },
      { href: '/memory/changes', label: 'Memory changes', icon: History },
      { href: '/memory/conflicts', label: 'Conflicts', icon: AlertTriangle },
      { href: '/knowledge/library', label: 'Library', icon: Library },
      { href: '/knowledge/upload', label: 'Upload', icon: Upload },
      { href: '/knowledge/search', label: 'Document search', icon: Search },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: '/settings', label: 'Settings', icon: Settings };
