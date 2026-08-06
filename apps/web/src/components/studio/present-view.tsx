'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import type { StudioDetail } from '@/lib/api';
import { SlideFrame, SLIDE_W } from './slide-frame';
import { SlideRenderer } from './slide-renderer';

function assetMap(detail: StudioDetail): Record<string, string> {
  return Object.fromEntries(detail.assets.filter((a) => a.url).map((a) => [a.id, a.url as string]));
}

/**
 * Full-screen presentation + print surface. On screen it's a keyboard-navigable
 * player; for PDF export it renders every slide one-per-page under a print
 * stylesheet, so "Download PDF" is just the browser's own print-to-PDF over the
 * exact same Tailwind slides (vector, selectable, zero server round-trip).
 */
export function PresentView({ detail }: { detail: StudioDetail }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const slides = detail.slides;
  const urls = useMemo(() => assetMap(detail), [detail]);
  const themeId = detail.themeId;

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(slides.length - 1, Math.max(0, i + delta))),
    [slides.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') router.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, router]);

  const current = slides[index];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 print:static print:bg-white">
      {/* Print styles: one slide per landscape page, hide the player chrome. */}
      <style>{`
        @page { size: 13.333in 7.5in; margin: 0; }
        @media print {
          html, body { background: #fff; }
          .studio-player { display: none !important; }
          .studio-print { display: block !important; }
          .studio-print-page { break-after: page; page-break-after: always; }
        }
      `}</style>

      {/* On-screen player */}
      <div className="studio-player flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-3 text-sm text-white/70">
          <span className="truncate">{detail.title}</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/10"
            >
              <Download className="h-4 w-4" /> PDF
            </button>
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/10"
            >
              <X className="h-4 w-4" /> Exit
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[min(90vw,1280px)] shadow-2xl">
            {current && (
              <SlideFrame>
                <SlideRenderer slide={current} themeId={themeId} assetUrls={urls} />
              </SlideFrame>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-6 p-4">
          <button
            onClick={() => go(-1)}
            disabled={index === 0}
            className="pointer-events-auto rounded-full bg-white/10 p-2 text-white disabled:opacity-30 hover:bg-white/20"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="pointer-events-auto text-sm text-white/60">
            {index + 1} / {slides.length}
          </span>
          <button
            onClick={() => go(1)}
            disabled={index >= slides.length - 1}
            className="pointer-events-auto rounded-full bg-white/10 p-2 text-white disabled:opacity-30 hover:bg-white/20"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Print-only: every slide, one per page, at exact page size. */}
      <div className="studio-print hidden">
        {slides.map((s) => (
          <div key={s.id} className="studio-print-page">
            <SlideFrame fixedWidth={SLIDE_W}>
              <SlideRenderer slide={s} themeId={themeId} assetUrls={urls} />
            </SlideFrame>
          </div>
        ))}
      </div>
    </div>
  );
}
