'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, LogOut, Sparkles } from 'lucide-react';
import { Button, cn } from '@company-brain/ui';
import { NAV, SETTINGS_ITEM, type NavItem } from '@/lib/nav';
import { useAuth } from '@/components/auth-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { useShell } from './shell-context';

function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid h-8 w-8 place-items-center rounded-[10px] bg-ai-gradient text-white shadow-glow',
        className,
      )}
    >
      <Sparkles className="h-4 w-4" />
    </span>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-accent"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      <Icon
        className={cn('relative z-10 h-4 w-4 transition-colors', active && 'text-ai')}
        strokeWidth={2}
      />
      <span className="relative z-10">{item.label}</span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const [devOpen, setDevOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-3 py-4">
        <BrandMark />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Company Brain</p>
          <p className="text-[11px] text-muted-foreground">Enterprise workspace</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-2">
        {NAV.map((group, gi) => (
          <div key={group.label ?? gi}>
            {group.label && !group.collapsible && (
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
            )}
            {group.collapsible ? (
              <>
                <button
                  onClick={() => setDevOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground"
                >
                  {group.label}
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', devOpen && 'rotate-180')}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {devOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-0.5 pt-1">
                        {group.items.map((item) => (
                          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t p-2">
        <NavLink item={SETTINGS_ITEM} onNavigate={onNavigate} />
        <div className="flex items-center gap-2 rounded-lg px-3 py-2">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ai-gradient text-[11px] font-semibold text-white">
            {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium">{user?.name ?? 'Account'}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void logout()}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-64 shrink-0 border-r bg-card/40 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileNavOpen(false)}
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-card md:hidden"
            >
              <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
