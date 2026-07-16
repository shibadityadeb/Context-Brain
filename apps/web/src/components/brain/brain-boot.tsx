'use client';

import { useEffect, useState } from 'react';
import { BootSequence } from './boot-sequence';

const KEY = 'brain.booted.v1';

/** Plays the cinematic intro once per browser session. */
export function BrainBoot() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!sessionStorage.getItem(KEY)) setShow(true);
  }, []);

  if (!show) return null;
  return (
    <BootSequence
      onDone={() => {
        sessionStorage.setItem(KEY, '1');
        setShow(false);
      }}
    />
  );
}
