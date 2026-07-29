'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Check,
  Clock,
  Crown,
  Loader2,
  Mail,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Button, Input, Label, cn } from '@company-brain/ui';
import {
  ApiRequestError,
  workspaceApi,
  type JoinRequest,
  type WorkspaceBrief,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { Badge, EmptyState, SkeletonCard } from '@/components/ui/primitives';
import { fadeUp, staggerContainer } from '@/lib/motion';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ai/12 text-xs font-semibold text-ai',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <motion.section variants={fadeUp} className="rounded-2xl border bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </motion.section>
  );
}

/* ── Invite panel ──────────────────────────────────────────────────────────── */

function InvitePanel({
  allowGuests,
  domain,
  onInvited,
}: {
  allowGuests: boolean;
  domain: string | null;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await workspaceApi.invite({ email: email.trim().toLowerCase(), role });
      setSent(email.trim().toLowerCase());
      setEmail('');
      onInvited();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="invite-email" className="sr-only">
            Email
          </Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={domain ? `teammate@${domain}` : 'teammate@company.com'}
            autoComplete="off"
          />
        </div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as WorkspaceRole)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Role"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <Button type="submit" className="gap-2" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Send invite
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {domain ? (
          <>
            Anyone with an <span className="font-medium text-foreground">@{domain}</span> email
            joins automatically.{' '}
            {allowGuests ? 'External guests can be invited here.' : 'External guests are disabled.'}
          </>
        ) : (
          'Invite teammates by email to collaborate.'
        )}
      </p>
      {sent && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" /> Invitation sent to {sent}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/* ── Rows ──────────────────────────────────────────────────────────────────── */

function MemberRow({
  member,
  isSelf,
  canManage,
  onChanged,
}: {
  member: WorkspaceMember;
  isSelf: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function setRole(role: WorkspaceRole) {
    if (role === member.role) return;
    setBusy(true);
    try {
      await workspaceApi.changeRole(member.membershipId, role);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${member.name} from the workspace?`)) return;
    setBusy(true);
    try {
      await workspaceApi.removeMember(member.membershipId);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <Avatar name={member.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium">{member.name}</p>
          {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
          {member.isOwner && (
            <Badge tone="ai">
              <Crown className="h-3 w-3" /> Owner
            </Badge>
          )}
          {member.isExternal && <Badge tone="warning">Guest</Badge>}
          {member.status === 'PENDING' && (
            <Badge tone="warning">
              <Clock className="h-3 w-3" /> Pending
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
      </div>

      {canManage && !member.isOwner ? (
        <div className="flex items-center gap-1.5">
          <select
            value={member.role}
            onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            disabled={busy}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label={`Role for ${member.name}`}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={remove}
            disabled={busy}
            aria-label={`Remove ${member.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Badge tone={member.role === 'admin' ? 'ai' : 'neutral'}>
          {member.role === 'admin' ? (
            <>
              <Shield className="h-3 w-3" /> Admin
            </>
          ) : (
            'Member'
          )}
        </Badge>
      )}
    </div>
  );
}

function RequestRow({ request, onDone }: { request: JoinRequest; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <Avatar name={request.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{request.name}</p>
          {request.isExternal && <Badge tone="warning">Guest</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">{request.email}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={() => act(() => workspaceApi.approveRequest(request.membershipId))}
        >
          <Check className="h-3.5 w-3.5" /> Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={() => act(() => workspaceApi.denyRequest(request.membershipId))}
        >
          <X className="h-3.5 w-3.5" /> Deny
        </Button>
      </div>
    </div>
  );
}

/* ── Settings ──────────────────────────────────────────────────────────────── */

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

function SettingsSection({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceBrief;
  onChanged: (next: WorkspaceBrief) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function patch(next: Parameters<typeof workspaceApi.updateSettings>[0], key: string) {
    setSaving(key);
    try {
      onChanged(await workspaceApi.updateSettings(next));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section title="Membership & access" description="Control who can join and how.">
      <div className="divide-y">
        <Toggle
          label="Require approval to join"
          description="New teammates from your domain wait for an admin to approve them."
          checked={workspace.requireApproval}
          disabled={saving === 'requireApproval'}
          onChange={(v) => patch({ requireApproval: v }, 'requireApproval')}
        />
        <Toggle
          label="Allow external guests"
          description="Invite collaborators from outside your company domain."
          checked={workspace.allowGuests}
          disabled={saving === 'allowGuests'}
          onChange={(v) => patch({ allowGuests: v }, 'allowGuests')}
        />
      </div>
    </Section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function WorkspacePage() {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceBrief | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  const me = members.find((m) => m.userId === user?.id);
  const isAdmin = !!me && (me.role === 'admin' || me.isOwner);

  const loadAdminData = useCallback(async () => {
    const [reqs, invs] = await Promise.all([
      workspaceApi.joinRequests().catch(() => []),
      workspaceApi.invitations().catch(() => []),
    ]);
    setRequests(reqs);
    setInvites(invs);
  }, []);

  const load = useCallback(async () => {
    const [onboarding, mem] = await Promise.all([
      workspaceApi.onboarding(),
      workspaceApi.members(),
    ]);
    if (onboarding.state === 'active') setWorkspace(onboarding.workspace);
    setMembers(mem);
    return mem;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const mem = await load();
        const mine = mem.find((m) => m.userId === user?.id);
        if (mine && (mine.role === 'admin' || mine.isOwner)) await loadAdminData();
      } finally {
        setLoading(false);
      }
    })();
  }, [load, loadAdminData, user?.id]);

  const refreshMembers = useCallback(() => void load(), [load]);
  const refreshAdmin = useCallback(() => void loadAdminData(), [loadAdminData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const soloMember = members.length === 1;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-3xl space-y-6 p-6"
    >
      {/* Identity header */}
      <motion.div variants={fadeUp} className="flex items-start gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border bg-ai/10 text-ai">
          <Building2 className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {workspace?.name ?? 'Your workspace'}
            </h1>
            {workspace?.emailDomain && <Badge tone="neutral">@{workspace.emailDomain}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace?.description ??
              'The shared memory of your organization — everyone contributes, everyone benefits.'}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        {isAdmin && (
          <Button className="gap-2" onClick={() => setShowInvite((v) => !v)}>
            <UserPlus className="h-4 w-4" /> Invite
          </Button>
        )}
      </motion.div>

      {/* Invite panel (admin) */}
      {isAdmin && showInvite && (
        <Section title="Invite teammates" description="Grow your shared Company Brain.">
          <InvitePanel
            allowGuests={workspace?.allowGuests ?? true}
            domain={workspace?.emailDomain ?? null}
            onInvited={refreshAdmin}
          />
        </Section>
      )}

      {/* Empty state — solo workspace */}
      {soloMember && !showInvite && (
        <motion.div variants={fadeUp}>
          <EmptyState
            icon={Users}
            title="Invite your teammates"
            description="A Company Brain gets smarter with every person who joins. Invite your team to start building shared organizational memory."
            action={
              isAdmin ? (
                <Button className="gap-2" onClick={() => setShowInvite(true)}>
                  <UserPlus className="h-4 w-4" /> Invite teammates
                </Button>
              ) : undefined
            }
          />
        </motion.div>
      )}

      {/* Join requests (admin) */}
      {isAdmin && requests.length > 0 && (
        <Section
          title="Join requests"
          description="People from your organization waiting to join."
          action={<Badge tone="warning">{requests.length}</Badge>}
        >
          <div className="divide-y">
            {requests.map((r) => (
              <RequestRow key={r.membershipId} request={r} onDone={refreshAdmin} />
            ))}
          </div>
        </Section>
      )}

      {/* Members */}
      <Section
        title="Members"
        description="Everyone contributing to this workspace."
        action={
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-4 w-4" /> {members.length}
          </span>
        }
      >
        <div className="divide-y">
          {members.map((m) => (
            <MemberRow
              key={m.membershipId}
              member={m}
              isSelf={m.userId === user?.id}
              canManage={isAdmin}
              onChanged={refreshMembers}
            />
          ))}
        </div>
      </Section>

      {/* Pending invitations (admin) */}
      {isAdmin && invites.length > 0 && (
        <Section title="Pending invitations" description="Invites that haven't been accepted yet.">
          <div className="divide-y">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited as {inv.role} · awaiting sign-in
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await workspaceApi.revokeInvitation(inv.id);
                    refreshAdmin();
                  }}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Settings (admin) */}
      {isAdmin && workspace && <SettingsSection workspace={workspace} onChanged={setWorkspace} />}

      {!isAdmin && (
        <motion.p
          variants={fadeUp}
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Only workspace admins can manage members and settings.
        </motion.p>
      )}
    </motion.div>
  );
}
