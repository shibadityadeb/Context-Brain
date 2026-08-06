'use client';

import { use, useEffect, useState } from 'react';
import { studioApi, type StudioDetail } from '@/lib/api';
import { StudioEditor } from '@/components/studio/editor/editor';
import { GeneratingView } from '@/components/studio/editor/generating-view';
import { ClarifyDialog } from '@/components/studio/editor/clarify-dialog';

export default function StudioEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<StudioDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    studioApi
      .get(id)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error)
    return (
      <div className="grid h-[70vh] place-items-center text-sm text-muted-foreground">{error}</div>
    );
  if (!detail)
    return (
      <div className="grid h-[70vh] place-items-center text-sm text-muted-foreground">Loading…</div>
    );

  if (detail.status === 'GENERATING') {
    return (
      <GeneratingView
        presentationId={id}
        initialProgress={detail.generationProgress}
        onDone={setDetail}
      />
    );
  }

  // Missing critical evidence → ask before building.
  if (detail.clarifications.length > 0 && detail.slides.length === 0) {
    return (
      <ClarifyDialog
        presentationId={id}
        clarifications={detail.clarifications}
        onSubmitted={setDetail}
      />
    );
  }

  if (detail.status === 'FAILED') {
    return (
      <div className="grid h-[70vh] place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium">Generation failed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.generationError ?? 'Please try again.'}
          </p>
        </div>
      </div>
    );
  }

  return <StudioEditor key={detail.id} initial={detail} />;
}
