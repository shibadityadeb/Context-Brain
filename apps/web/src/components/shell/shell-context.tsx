'use client';

import { createContext, useContext, useMemo, useState } from 'react';

interface ShellState {
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  aiOpen: boolean;
  setAiOpen: (v: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const value = useMemo(
    () => ({ commandOpen, setCommandOpen, mobileNavOpen, setMobileNavOpen, aiOpen, setAiOpen }),
    [commandOpen, mobileNavOpen, aiOpen],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within ShellProvider');
  return ctx;
}
