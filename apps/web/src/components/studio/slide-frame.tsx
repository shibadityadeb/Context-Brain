'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Logical slide size (16:9). Everything inside is sized in `em`/`%` against
 *  this, then the whole frame is transform-scaled to fit its container — so a
 *  slide looks identical as a thumbnail, on the editor stage, and in print. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;
const BASE_FONT = 22;

/**
 * Scales a fixed 1280×720 slide to the width of its parent. Uses a ResizeObserver
 * so thumbnails, the stage, and the present view all share one renderer at
 * different scales with pixel-consistent layout.
 */
export function SlideFrame({
  children,
  className,
  fixedWidth,
}: {
  children: ReactNode;
  className?: string;
  /** Render at an explicit width (e.g. print) instead of measuring the parent. */
  fixedWidth?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fixedWidth ?? 0);

  useEffect(() => {
    if (fixedWidth) return;
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedWidth]);

  const scale = width ? width / SLIDE_W : 0;

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        position: 'relative',
        width: fixedWidth ?? '100%',
        height: width ? width * (SLIDE_H / SLIDE_W) : 'auto',
        aspectRatio: `${SLIDE_W} / ${SLIDE_H}`,
      }}
    >
      {scale > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: SLIDE_W,
            height: SLIDE_H,
            fontSize: BASE_FONT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
