'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  Check,
  Clock,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { Button, Input, Label } from '@company-brain/ui';
import {
  ApiRequestError,
  workspaceApi,
  type OnboardingState,
  type WorkspacePreview,
} from '@/lib/api';

/** Where a user lands once they belong to an active workspace. */
const HOME = '/home';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/* ── Shell ─────────────────────────────────────────────────────────────────── */

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 120% at 15% 0%, rgba(99,102,241,0.18), transparent 55%), radial-gradient(100% 100% at 90% 100%, rgba(168,85,247,0.16), transparent 55%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Image src="/logo.png" alt="Company Brain" width={30} height={30} priority />
          <span className="font-semibold">Company Brain</span>
        </div>
        <div className="rounded-2xl border bg-card/80 p-7 shadow-sm backdrop-blur">{children}</div>
      </motion.div>
    </div>
  );
}

function MemberStack({ ws }: { ws: WorkspacePreview }) {
  const extra = ws.memberCount - ws.members.length;
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {ws.members.slice(0, 5).map((name, i) => (
          <span
            key={`${name}-${i}`}
            title={name}
            className="grid h-8 w-8 place-items-center rounded-full border-2 border-card bg-ai/12 text-[11px] font-semibold text-ai"
          >
            {initials(name)}
          </span>
        ))}
        {extra > 0 && (
          <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-card bg-muted text-[11px] font-semibold text-muted-foreground">
            +{extra}
          </span>
        )}
      </div>
      <span className="text-sm text-muted-foreground">
        {ws.memberCount} {ws.memberCount === 1 ? 'member' : 'members'}
      </span>
    </div>
  );
}

/* ── Views ─────────────────────────────────────────────────────────────────── */

function CreateWorkspaceView({
  suggestedName,
  domain,
  personal,
  onCreated,
}: {
  suggestedName: string;
  domain: string | null;
  personal?: boolean;
  onCreated: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await workspaceApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the workspace.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl border bg-ai/10">
        <Building2 className="h-5 w-5 text-ai" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {personal
          ? 'This is your private Company Brain. Invite teammates any time.'
          : 'Your teammates will discover and join this workspace automatically when they sign in.'}
      </p>

      <div className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc"
            autoFocus
            maxLength={100}
          />
          {domain && (
            <p className="text-xs text-muted-foreground">
              Detected from your <span className="font-medium text-foreground">@{domain}</span>{' '}
              email
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ws-desc">
            Description <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="ws-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does your organization do?"
            maxLength={2000}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="mt-6 h-11 w-full gap-2" disabled={busy || !name.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Create workspace
      </Button>
    </form>
  );
}

function DiscoverWorkspaceView({
  workspace,
  requireApproval,
  onJoined,
  onPending,
}: {
  workspace: WorkspacePreview;
  requireApproval: boolean;
  onJoined: () => void;
  onPending: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { status } = await workspaceApi.join(workspace.id);
      if (status === 'ACTIVE') onJoined();
      else onPending();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not join the workspace.');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-[11px] font-medium text-success">
        <Check className="h-3 w-3" /> Workspace found
      </div>
      <h1 className="text-xl font-semibold tracking-tight">
        We found your organization&rsquo;s workspace
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Everyone at <span className="font-medium text-foreground">@{workspace.emailDomain}</span>{' '}
        shares one Company Brain.
      </p>

      <div className="mt-6 rounded-xl border bg-background/40 p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border bg-ai/10 text-ai">
            {workspace.logoUrl ? (
              <Image src={workspace.logoUrl} alt="" width={44} height={44} className="rounded-xl" />
            ) : (
              <Building2 className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{workspace.name}</p>
            {workspace.owner && (
              <p className="text-xs text-muted-foreground">Created by {workspace.owner}</p>
            )}
          </div>
        </div>
        {workspace.description && (
          <p className="mt-3 text-sm text-muted-foreground">{workspace.description}</p>
        )}
        <div className="mt-4">
          <MemberStack ws={workspace} />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button className="mt-6 h-11 w-full gap-2" onClick={join} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
        {requireApproval ? 'Request to join' : 'Join workspace'}
        {!busy && <ArrowRight className="h-4 w-4" />}
      </Button>
      {requireApproval && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          An administrator will review your request.
        </p>
      )}
    </div>
  );
}

function InvitedView({
  workspace,
  onJoined,
  onPending,
}: {
  workspace: WorkspacePreview;
  onJoined: () => void;
  onPending: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const { status } = await workspaceApi.join(workspace.id);
      if (status === 'ACTIVE') onJoined();
      else onPending();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not accept the invitation.');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-ai/10 px-2.5 py-1 text-[11px] font-medium text-ai">
        <Mail className="h-3 w-3" /> You&rsquo;re invited
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Join {workspace.name}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        You&rsquo;ve been invited to collaborate in this Company Brain.
      </p>

      <div className="mt-6 rounded-xl border bg-background/40 p-4">
        <p className="font-semibold">{workspace.name}</p>
        {workspace.owner && (
          <p className="text-xs text-muted-foreground">Created by {workspace.owner}</p>
        )}
        <div className="mt-4">
          <MemberStack ws={workspace} />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button className="mt-6 h-11 w-full gap-2" onClick={accept} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Accept invitation
      </Button>
    </div>
  );
}

function PendingView({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl border bg-warning/10">
        <Clock className="h-6 w-6 text-warning" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Request sent</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
        Your request to join <span className="font-medium text-foreground">{workspaceName}</span>{' '}
        has been sent to the workspace administrators. You&rsquo;ll get access as soon as it&rsquo;s
        approved.
      </p>
      <Button variant="outline" className="mt-6 h-10 w-full" onClick={() => router.refresh()}>
        Check again
      </Button>
    </div>
  );
}

/* ── Flow ──────────────────────────────────────────────────────────────────── */

export function OnboardingFlow() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [pending, setPending] = useState<{ name: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const enterApp = useCallback(() => router.replace(HOME), [router]);

  const load = useCallback(async () => {
    try {
      const result = await workspaceApi.onboarding();
      if (result.state === 'active') {
        enterApp();
        return;
      }
      if (result.state === 'pending') {
        setPending({ name: result.workspace.name });
        return;
      }
      setState(result);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setFailed(true);
    }
  }, [enterApp, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (pending) {
    return (
      <Panel>
        <PendingView workspaceName={pending.name} />
      </Panel>
    );
  }

  if (failed) {
    return (
      <Panel>
        <div className="text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn&rsquo;t load your workspace. Please try again.
          </p>
          <Button className="mt-5 h-10 w-full" onClick={() => location.reload()}>
            Retry
          </Button>
        </div>
      </Panel>
    );
  }

  if (!state) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Setting up your workspace…</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      {state.state === 'no_workspace' && (
        <CreateWorkspaceView
          suggestedName={state.suggestedName}
          domain={state.domain}
          personal={state.personal}
          onCreated={enterApp}
        />
      )}
      {state.state === 'workspace_found' && (
        <DiscoverWorkspaceView
          workspace={state.workspace}
          requireApproval={state.requireApproval}
          onJoined={enterApp}
          onPending={() => setPending({ name: state.workspace.name })}
        />
      )}
      {state.state === 'invited' && (
        <InvitedView
          workspace={state.workspace}
          onJoined={enterApp}
          onPending={() => setPending({ name: state.workspace.name })}
        />
      )}
    </Panel>
  );
}
