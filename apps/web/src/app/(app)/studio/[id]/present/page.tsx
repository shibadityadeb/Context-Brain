'use client';

import { use, useEffect, useState } from 'react';
import { studioApi, type StudioDetail } from '@/lib/api';
import { PresentView } from '@/components/studio/present-view';

export default function PresentPage({ params }: { params: Promise<{ id: string }> }) {
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
      <div className="grid h-screen place-items-center text-sm text-muted-foreground">{error}</div>
    );
  if (!detail)
    return (
      <div className="grid h-screen place-items-center text-sm text-muted-foreground">Loading…</div>
    );
  if (!detail.slides.length)
    return (
      <div className="grid h-screen place-items-center text-sm text-muted-foreground">
        This presentation has no slides yet.
      </div>
    );

  return <PresentView detail={detail} />;
}
