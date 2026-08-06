'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { StoryExperience } from '@/components/story/story-experience';
import { StoryBuilding, StoryQuestions } from '@/components/story/generation';
import { studioApi, type StudioDetail } from '@/lib/api';

/**
 * The story URL — one address for the whole lifecycle.
 *
 * Deliberately outside the `(app)` route group: a story is a standalone site,
 * not an app workspace view, so it must never inherit the sidebar or topbar.
 *
 * The same URL carries the brief from generation to delivery — building, then
 * any questions, then the finished experience — so a founder can share the link
 * the moment they hit Generate and it becomes the real thing underneath them.
 */
export default function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<StudioDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await studioApi.get(id));
    } catch {
      setError('This story is unavailable.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#08080a] text-sm text-white/50">
        {error}
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#08080a] text-sm text-white/40">
        Opening the story…
      </main>
    );
  }

  if (detail.status === 'GENERATING') {
    return (
      <StoryBuilding
        presentationId={id}
        initialProgress={detail.generationProgress}
        onDone={setDetail}
      />
    );
  }

  // A decision only the user can make. Shown before anything is built, never
  // after — the readiness gate runs first precisely so this arrives in seconds.
  if (detail.clarifications.length > 0 && !detail.story?.scenes?.length) {
    return (
      <StoryQuestions
        presentationId={id}
        clarifications={detail.clarifications}
        readiness={detail.readiness}
        onSubmitted={setDetail}
      />
    );
  }

  if (detail.status === 'FAILED') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#08080a] px-6 text-center">
        <div>
          <p className="text-sm font-medium text-white/80">The story could not be built.</p>
          <p className="mt-2 max-w-md text-sm text-white/45">
            {detail.generationError ?? 'Please try again.'}
          </p>
        </div>
      </main>
    );
  }

  return <StoryExperience detail={detail} />;
}
