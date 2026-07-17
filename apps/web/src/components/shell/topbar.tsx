'use client';

import { useRouter } from 'next/navigation';
import { Menu, Search, Sparkles } from 'lucide-react';
import { Button } from '@company-brain/ui';
import { Kbd } from '@/components/ui/primitives';
import { ActivityIndicator } from './activity-indicator';
import { useShell } from './shell-context';

export function Topbar() {
  const { setCommandOpen, setMobileNavOpen } = useShell();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/70 px-4 backdrop-blur-xl">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <button
        onClick={() => setCommandOpen(true)}
        className="group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/70"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Ask your Company Brain…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <ActivityIndicator />
        <Button
          size="sm"
          className="gap-1.5 bg-ai-gradient text-white hover:opacity-90"
          onClick={() => router.push('/ask')}
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">Ask Brain</span>
        </Button>
      </div>
    </header>
  );
}
