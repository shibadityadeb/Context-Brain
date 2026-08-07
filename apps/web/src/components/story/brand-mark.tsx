'use client';

import { useEffect, useState } from 'react';

/**
 * Brand mark rendering with honest dark-mode adaptation.
 *
 * The naive approach — `filter: invert(1)` on dark backgrounds — destroys any
 * logo that isn't monochrome, turning a brand's blue into orange. So instead we
 * measure: the image is sampled on a canvas, and we only invert when the mark is
 * genuinely near-monochrome AND its luminance fights the surface it's on. A
 * colourful logo is always left exactly as the brand designed it.
 *
 * Falls back to "leave it alone" on any uncertainty, including cross-origin
 * images where the canvas is tainted and pixels can't be read.
 */

type Treatment = 'as-is' | 'invert';

interface Sample {
  /** 0..1 perceived luminance of the non-transparent pixels. */
  luminance: number;
  /** How far the mark strays from grey. Low = safe to invert. */
  chroma: number;
}

const cache = new Map<string, Sample | null>();

function sampleImage(url: string): Promise<Sample | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(image, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let total = 0;
        let luminance = 0;
        let chroma = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3]! / 255;
          if (alpha < 0.35) continue; // ignore transparent padding
          const r = data[i]! / 255;
          const g = data[i + 1]! / 255;
          const b = data[i + 2]! / 255;
          luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          chroma += Math.max(r, g, b) - Math.min(r, g, b);
          total += 1;
        }
        if (!total) return resolve(null);
        const result: Sample = { luminance: luminance / total, chroma: chroma / total };
        cache.set(url, result);
        resolve(result);
      } catch {
        // Tainted canvas (cross-origin without CORS headers) — never guess.
        cache.set(url, null);
        resolve(null);
      }
    };
    image.onerror = () => {
      cache.set(url, null);
      resolve(null);
    };
    image.src = url;
  });
}

function useLogoTreatment(url: string | null | undefined, surface: 'light' | 'dark'): Treatment {
  const [sample, setSample] = useState<Sample | null>(null);

  useEffect(() => {
    if (!url) return;
    let active = true;
    void sampleImage(url).then((result) => {
      if (active) setSample(result);
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (!sample) return 'as-is';
  // Only near-monochrome marks are safe to flip.
  if (sample.chroma > 0.12) return 'as-is';
  const isDarkMark = sample.luminance < 0.42;
  const isLightMark = sample.luminance > 0.62;
  if (surface === 'dark' && isDarkMark) return 'invert';
  if (surface === 'light' && isLightMark) return 'invert';
  return 'as-is';
}

export function BrandMark({
  url,
  surface,
  className = '',
  alt = '',
}: {
  url?: string | null;
  surface: 'light' | 'dark';
  className?: string;
  alt?: string;
}) {
  const treatment = useLogoTreatment(url, surface);
  if (!url) return null;
  return (
    // A plain <img>: these are signed, expiring storage URLs, so next/image
    // cannot statically optimise them and would only add a proxy hop.
    <img
      src={url}
      alt={alt}
      className={className}
      style={treatment === 'invert' ? { filter: 'invert(1) brightness(1.9)' } : undefined}
    />
  );
}
