'use client';

import { AuthProvider, useAuth } from '@/components/auth-provider';
import { ShellProvider } from '@/components/shell/shell-context';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { CommandMenu } from '@/components/shell/command-menu';
import { AiDock } from '@/components/shell/ai-dock';
import { PageTransition } from '@/components/shell/page-transition';
import { BrandMark } from '@/components/shell/sidebar';

function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <BrandMark className="h-10 w-10 animate-float" />
          <p className="text-sm text-muted-foreground">Loading your workspace…</p>
        </div>
      </div>
    );
  }
  if (!user) return null; // AuthProvider is redirecting to /login

  return (
    <ShellProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      <CommandMenu />
      <AiDock />
    </ShellProvider>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
