'use client';

import Link from 'next/link';
import { Copy, ImagePlus, Loader2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioDetail } from '@/lib/api';
import { studioApi } from '@/lib/api';
import { compileExperience, type StorySection } from './compiler';
import {
  ArchitectureSection,
  CTASection,
  FeatureSection,
  HeroSection,
  MetricSection,
  ProblemSection,
  RevealSection,
  TimelineSection,
  TransitionSection,
} from './sections';

const components = {
  hero: HeroSection,
  problem: ProblemSection,
  transition: TransitionSection,
  metrics: MetricSection,
  architecture: ArchitectureSection,
  timeline: TimelineSection,
  reveal: RevealSection,
  features: FeatureSection,
  cta: CTASection,
} as const;

/** A standalone, shareable storytelling website. It has no Studio renderer,
 * canvas or slide navigation — scrolling is the presentation. */
export function StoryExperience({ detail }: { detail: StudioDetail }) {
  const [assets, setAssets] = useState(detail.assets);
  const [logoId, setLogoId] = useState(detail.coverAssetId);
  const [uploading, setUploading] = useState<'logo' | 'image' | null>(null);
  const [copied, setCopied] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const story = useMemo(
    () => ({ ...detail, assets, coverAssetId: logoId }),
    [assets, detail, logoId],
  );
  const sections = compileExperience(story);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () =>
      setProgress(window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight));
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  const upload = async (kind: 'logo' | 'image', file?: File) => {
    if (!file) return;
    setUploading(kind);
    try {
      const asset = await studioApi.uploadAsset(detail.id, file);
      setAssets((current) => [
        ...current,
        { ...asset, mimeType: file.type, caption: null, width: null, height: null },
      ]);
      if (kind === 'logo') {
        await studioApi.update(detail.id, { coverAssetId: asset.id });
        setLogoId(asset.id);
      }
    } finally {
      setUploading(null);
    }
  };
  const logo = assets.find((asset) => asset.id === logoId)?.url;
  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <main className="bg-[#090a0e] [scroll-snap-type:y_mandatory]">
      <div
        className="fixed inset-x-0 top-0 z-50 h-px origin-left bg-[#e8c56a]"
        style={{ transform: `scaleX(${progress})` }}
      />
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-3 px-6 py-5 mix-blend-difference sm:px-10">
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            <img
              src={logo}
              alt="Company logo"
              className="h-7 max-w-28 object-contain object-left"
            />
          ) : (
            <Link
              href={`/studio/${detail.id}`}
              className="text-xs font-medium tracking-wide text-white/80 hover:text-white"
            >
              ← Back to Studio
            </Link>
          )}
          <span className="hidden max-w-[32vw] truncate text-xs tracking-[.18em] text-white/60 sm:block">
            {detail.title}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={copyUrl}
            className="rounded-full border border-white/20 px-3 py-1.5 text-white/80 hover:bg-white/10"
          >
            <Copy className="mr-1 inline h-3 w-3" />
            {copied ? 'Copied' : 'Copy live URL'}
          </button>
          <button
            onClick={() => logoRef.current?.click()}
            className="hidden rounded-full border border-white/20 px-3 py-1.5 text-white/80 hover:bg-white/10 sm:block"
          >
            {uploading === 'logo' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Upload className="mr-1 inline h-3 w-3" />
                Logo
              </>
            )}
          </button>
          <button
            onClick={() => imageRef.current?.click()}
            className="hidden rounded-full border border-white/20 px-3 py-1.5 text-white/80 hover:bg-white/10 sm:block"
          >
            {uploading === 'image' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <ImagePlus className="mr-1 inline h-3 w-3" />
                Images
              </>
            )}
          </button>
        </div>
        <input
          ref={logoRef}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => {
            void upload('logo', event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={imageRef}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => {
            void upload('image', event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </header>
      {sections.map((section) => {
        const Component = components[section.kind];
        return <Component key={section.id} section={section as StorySection} />;
      })}
    </main>
  );
}
