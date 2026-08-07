'use client';

import Lenis from 'lenis';
import { useEffect, useMemo, useState } from 'react';
import { artDirectionCssVars } from '@company-brain/studio';
import { studioApi, type StudioDetail } from '@/lib/api';
import { LogoIntro, SceneRail, ScrollProgress, StoryHeader, useActiveScene } from './chrome';
import { StoryDirector } from './director';
import { resolveStory } from './lib/legacy';
import { useReducedMotionSafe } from './lib/motion';
import { SCENE_COMPONENTS } from './scenes';

/**
 * The interactive website — the flagship output of the Storytelling Engine.
 *
 * This is a standalone site, not a Studio view: no sidebar, no app chrome, no
 * slide canvas. It renders the composed scene list natively, which is what makes
 * it an experience rather than a deck with scroll behaviour bolted on.
 *
 * The art direction resolves once here into CSS custom properties on the root,
 * so every scene, every diagram and the print sheet all read from one set of
 * tokens — and swapping the palette restyles the entire site instantly.
 */
export function StoryExperience({
  detail: initial,
  editable = true,
}: {
  detail: StudioDetail;
  /** Off for a read-only share of the story. */
  editable?: boolean;
}) {
  const reduced = useReducedMotionSafe();
  const [downloading, setDownloading] = useState<string | null>(null);
  // Revisions replace the story in place, so the reader sees the change land
  // without a reload or losing their scroll position.
  const [detail, setDetail] = useState(initial);
  useEffect(() => setDetail(initial), [initial]);

  const story = useMemo(() => resolveStory(detail), [detail]);

  const assetUrls = useMemo(
    () =>
      Object.fromEntries(
        detail.assets.filter((asset) => asset.url).map((asset) => [asset.id, asset.url as string]),
      ),
    [detail.assets],
  );
  const logoUrl = detail.coverAssetId ? (assetUrls[detail.coverAssetId] ?? null) : null;

  const scenes = story?.scenes ?? [];
  const active = useActiveScene(scenes);

  /**
   * Smooth scrolling. Lenis is what makes scroll-driven motion feel authored
   * rather than mechanical — but it is opt-out: reduced-motion users get the
   * browser's native scrolling, untouched.
   */
  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({
      duration: 1.05,
      // Gentle exponential settle — matches the easing used across the scenes.
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 1.6,
    });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    // Anchor links must be handed to Lenis or they fight the smooth scroller.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href^="#"]');
      if (!anchor) return;
      const id = anchor.getAttribute('href')?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target, { offset: 0 });
    };
    document.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('click', onClick);
      lenis.destroy();
    };
  }, [reduced]);

  const download = async (kind: 'pptx' | 'pdf' | 'source') => {
    setDownloading(kind);
    try {
      await studioApi.download(detail.id, kind, detail.title || 'story');
    } finally {
      setDownloading(null);
    }
  };

  if (!story || !scenes.length) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#08080a] text-sm text-white/50">
        This story has no scenes yet.
      </main>
    );
  }

  return (
    <main
      className="story-root relative"
      style={{ ...artDirectionCssVars(story.art), background: story.art.base }}
    >
      <LogoIntro logoUrl={logoUrl} art={story.art} />
      <ScrollProgress art={story.art} />
      <StoryHeader
        title={story.title}
        logoUrl={logoUrl}
        downloading={downloading}
        onDownload={(kind) => void download(kind)}
        links={{
          presentHref: `/studio/${detail.id}/present`,
          editHref: `/studio/${detail.id}`,
        }}
      />
      <SceneRail scenes={scenes} active={active} />
      {editable && <StoryDirector detail={detail} art={story.art} onUpdated={setDetail} />}

      {scenes.map((scene) => {
        const Scene = SCENE_COMPONENTS[scene.kind];
        return (
          <Scene
            key={scene.id}
            scene={scene}
            art={story.art}
            assetUrls={assetUrls}
            logoUrl={logoUrl}
            total={scenes.length}
          />
        );
      })}

      <footer
        className="flex flex-col items-center gap-3 px-6 py-14 text-center"
        style={{ background: story.art.base, color: story.art.inkMuted }}
      >
        {story.tagline && (
          <p
            className="max-w-[46ch] text-[0.82rem] leading-relaxed"
            style={{ fontFamily: 'var(--story-body)' }}
          >
            {story.tagline}
          </p>
        )}
        <p
          className="text-[0.66rem] uppercase tracking-[0.24em] opacity-50"
          style={{ fontFamily: 'var(--story-body)' }}
        >
          Built from Company Brain
        </p>
      </footer>
    </main>
  );
}
