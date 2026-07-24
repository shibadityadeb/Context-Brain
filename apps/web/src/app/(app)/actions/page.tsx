'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';
import {
  actionApi,
  type ActionDetail,
  type ActionSummary,
  type ActionView,
  type EditActionStep,
} from '@/lib/api';
import { ActionComposer } from './_components/action-composer';
import { ActionFeed } from './_components/action-feed';
import { ActionDetailPanel } from './_components/action-detail';
import { isLive } from './_components/status';

function ActionsWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const activeId = params.get('a');

  const [view, setView] = useState<ActionView>('active');
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<ActionDetail | null>(null);
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const detailReqId = useRef(0);

  const loadList = useCallback(async () => {
    try {
      const res = await actionApi.list({ view, limit: 100 });
      setActions(res.items);
      setCounts(res.counts);
    } catch {
      /* keep prior list */
    }
  }, [view]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Load the selected action.
  const loadDetail = useCallback(async (id: string) => {
    const reqId = ++detailReqId.current;
    try {
      const d = await actionApi.get(id);
      if (reqId === detailReqId.current) setDetail(d);
    } catch {
      if (reqId === detailReqId.current) setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    void loadDetail(activeId);
  }, [activeId, loadDetail]);

  // Poll while the selected action is planning/approved/running so step progress
  // and execution logs stream in, and keep the feed's statuses fresh.
  useEffect(() => {
    if (!detail || !isLive(detail.status)) return;
    const timer = setInterval(() => {
      void loadDetail(detail.id);
      void loadList();
    }, 1500);
    return () => clearInterval(timer);
  }, [detail, loadDetail, loadList]);

  const select = useCallback((id: string) => router.replace(`/actions?a=${id}`), [router]);

  async function createAction(request: string) {
    setPlanning(true);
    try {
      const action = await actionApi.create({ request });
      await loadList();
      select(action.id);
      setDetail(action);
    } catch {
      /* surfaced by the empty feed; user can retry */
    } finally {
      setPlanning(false);
    }
  }

  async function mutate(fn: () => Promise<ActionDetail | { deleted: boolean }>, removed = false) {
    setBusy(true);
    try {
      const result = await fn();
      await loadList();
      if (removed) {
        router.replace('/actions');
        setDetail(null);
      } else {
        setDetail(result as ActionDetail);
      }
    } catch {
      if (activeId) void loadDetail(activeId);
    } finally {
      setBusy(false);
    }
  }

  const approve = (id: string) => mutate(() => actionApi.approve(id));
  const answer = (id: string, a: Array<{ field: string; value: string }>) =>
    mutate(() => actionApi.answer(id, a));
  const reject = (id: string, reason?: string) => mutate(() => actionApi.reject(id, reason));
  const cancel = (id: string) => mutate(() => actionApi.cancel(id));
  const remove = (id: string) => mutate(() => actionApi.remove(id), true);
  const edit = (
    id: string,
    draft: { title: string; goal: string; estimatedImpact: string; steps: EditActionStep[] },
  ) => mutate(() => actionApi.edit(id, draft));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Actions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Turn knowledge into work. Codex plans it, you approve, OpenClaw executes — and every
          action is recorded in your Brain.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(320px,380px)_1fr]">
        <div className="flex h-[calc(100vh-13rem)] min-h-0 flex-col gap-4">
          <ActionComposer planning={planning} onSubmit={(r) => void createAction(r)} />
          <div className="min-h-0 flex-1 border-t pt-3">
            <ActionFeed
              view={view}
              counts={counts}
              actions={actions}
              activeId={activeId}
              onView={setView}
              onSelect={select}
            />
          </div>
        </div>

        <div className="h-[calc(100vh-13rem)] min-h-0 rounded-2xl border bg-card/30 p-5">
          {detail ? (
            <ActionDetailPanel
              action={detail}
              busy={busy}
              onApprove={() => void approve(detail.id)}
              onAnswer={(a) => void answer(detail.id, a)}
              onReject={(reason) => void reject(detail.id, reason)}
              onEdit={(draft) => void edit(detail.id, draft)}
              onCancel={() => void cancel(detail.id)}
              onDelete={() => void remove(detail.id)}
            />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={Zap}
                title="No action selected"
                description="Describe what you want done above. Codex will draft a step-by-step plan for your approval before anything runs."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActionsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <ActionsWorkspace />
    </Suspense>
  );
}
