'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  Boxes,
  Brain,
  Cable,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  Library,
  LogOut,
  Network,
  Search,
  Settings,
  Sparkles,
  Upload,
  User,
} from 'lucide-react';
import { Button, cn } from '@company-brain/ui';
import { AuthProvider, useAuth } from '@/components/auth-provider';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/knowledge', label: 'Knowledge', icon: FileText },
  { href: '/knowledge/upload', label: 'Upload', icon: Upload },
  { href: '/knowledge/library', label: 'Library', icon: Library },
  { href: '/knowledge/search', label: 'Search', icon: Search },
  { href: '/brain', label: 'Brain', icon: Sparkles },
  { href: '/brain/graph', label: 'Graph', icon: Network },
  { href: '/brain/timeline', label: 'Timeline', icon: History },
  { href: '/memory', label: 'Memory', icon: Boxes },
  { href: '/memory/changes', label: 'Changes', icon: Clock },
  { href: '/memory/conflicts', label: 'Conflicts', icon: AlertTriangle },
  { href: '/connectors', label: 'Connectors', icon: Cable },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return null; // AuthProvider is redirecting to /login

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 flex-col border-r p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2 font-semibold">
          <Brain className="h-6 w-6" />
          Company Brain
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <Button variant="ghost" className="justify-start gap-3" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
          <ThemeToggle />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
