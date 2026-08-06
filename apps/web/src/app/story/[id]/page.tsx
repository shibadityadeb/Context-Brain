'use client';

import { use, useEffect, useState } from 'react';
import { StoryExperience } from '@/components/story/story-experience';
import { studioApi, type StudioDetail } from '@/lib/api';

/**
 * Deliberately outside the `(app)` route group. A story is a standalone site,
 * not an app workspace view — it must never inherit the Studio/sidebar/topbar.
 */
export default function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<StudioDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void studioApi
      .get(id)
      .then(setDetail)
      .catch(() => setError('This story is unavailable.'));
  }, [id]);

  // A Web output has a permanent URL immediately. Keep this standalone page in
  // sync while its async generation finishes, rather than sending the user back
  // to Studio to wait for it.
  useEffect(() => {
    if (detail?.status !== 'GENERATING') return;
    const timer = window.setInterval(() => {
      void studioApi.get(id).then(setDetail);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [detail?.status, id]);

  if (error)
    return (
      <main className="grid min-h-screen place-items-center bg-[#090a0e] text-sm text-white/55">
        {error}
      </main>
    );
  if (!detail)
    return (
      <main className="grid min-h-screen place-items-center bg-[#090a0e] text-sm text-white/55">
        Building the story…
      </main>
    );
  return <StoryExperience detail={detail} />;
}
