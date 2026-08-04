'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  FileText,
  Gavel,
  HelpCircle,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge, Thinking } from '@/components/ui/primitives';
import {
  governanceApi,
  type GovernanceAnswer,
  type GovernanceAssessment,
  type GovernanceDocumentRef,
  type GovMissingInfo,
} from '@/lib/api';

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

const OVERVIEW_QUESTION =
  'If we are launching this product, what should we keep in mind to do it compliantly — which laws & frameworks apply, what documents and controls to put in place, and what still needs deciding?';

/** Fields that accept several answers (a product spans many countries / data types). */
const MULTI_FIELDS = new Set(['countries', 'dataCategories']);

const COUNTRY_MAP: Record<string, string[]> = {
  'European Union': ['DE', 'FR'],
  'United Kingdom': ['GB'],
  'United States': ['US'],
  India: ['IN'],
  Canada: ['CA'],
  Australia: ['AU'],
  Singapore: ['SG'],
  Global: ['US', 'DE', 'GB', 'IN'],
};
const DATA_MAP: Record<string, string[]> = {
  'Basic PII (name/email)': ['PII'],
  'Sensitive PII': ['SENSITIVE_PII'],
  Biometric: ['BIOMETRIC'],
  Health: ['HEALTH'],
  Financial: ['FINANCIAL'],
  "Children's data": ['CHILDREN'],
  Location: ['LOCATION'],
  None: [],
};
const INDUSTRY_MAP: Record<string, string> = {
  'Generic SaaS': 'GENERIC',
  Fintech: 'FINTECH',
  Healthcare: 'HEALTHCARE',
  Education: 'EDUCATION',
  Government: 'GOVERNMENT',
  'E-commerce': 'ECOMMERCE',
  AdTech: 'ADTECH',
  Social: 'SOCIAL',
  AI: 'AI',
};

/** Build a profile patch from one or more selected choices for a missing field. */
function resolveAnswer(field: string, options: string[]): Record<string, unknown> | null {
  if (field === 'countries') {
    return { countries: [...new Set(options.flatMap((o) => COUNTRY_MAP[o] ?? []))] };
  }
  if (field === 'dataCategories') {
    return { dataCategories: [...new Set(options.flatMap((o) => DATA_MAP[o] ?? []))] };
  }
  const only = options[0];
  if (!only) return null;
  if (field === 'industry') return { industry: INDUSTRY_MAP[only] ?? 'GENERIC' };
  if (field === 'authentication') return { authentication: only };
  if (field === 'cloudProvider') return { cloudProvider: only };
  return null;
}

interface DraftState {
  type: string;
  title: string;
  content: string;
  loading: boolean;
  saving: boolean;
  saved: boolean;
}

export function GovernancePanel({ product, onExit }: { product: string; onExit: () => void }) {
  const [data, setData] = useState<GovernanceAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await governanceApi.command({ product, question: OVERVIEW_QUESTION });
      setData(res);
    } catch {
      setError('Could not run the governance assessment.');
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => {
    void load();
  }, [load]);

  const ask = useCallback(
    async (question: string) => {
      if (!data || busy) return;
      setBusy(true);
      try {
        const res = await governanceApi.ask(data.profileId, { question });
        setData({ ...data, answer: res.answer, assessment: res.assessment, sources: res.sources });
      } catch {
        /* keep prior answer */
      } finally {
        setBusy(false);
      }
    },
    [data, busy],
  );

  const answerMissing = useCallback(
    async (m: GovMissingInfo, options: string[]) => {
      if (!data || busy) return;
      const patch = resolveAnswer(m.field, options);
      if (!patch) return;
      setBusy(true);
      try {
        const res = await governanceApi.update(data.profileId, patch);
        if (res.assessment) setData({ ...data, assessment: res.assessment });
      } finally {
        setBusy(false);
      }
    },
    [data, busy],
  );

  // Document drafting: preview-only (nothing saved) until the user hits Save.
  const [draft, setDraft] = useState<DraftState | null>(null);

  const previewDoc = useCallback(
    async (type: string, title: string) => {
      if (!data) return;
      setDraft({ type, title, content: '', loading: true, saving: false, saved: false });
      try {
        const res = await governanceApi.generateDocument(data.profileId, type, false);
        setDraft((d) =>
          d && d.type === type
            ? { ...d, loading: false, title: res.title, content: res.content }
            : d,
        );
      } catch {
        setDraft((d) =>
          d ? { ...d, loading: false, content: 'Could not draft this document. Try again.' } : d,
        );
      }
    },
    [data],
  );

  // Saved documents (persisted drafts) for this profile.
  const [docs, setDocs] = useState<GovernanceDocumentRef[]>([]);
  const loadDocs = useCallback(async (profileId: string) => {
    try {
      const res = await governanceApi.listDocuments(profileId);
      setDocs(res.documents);
    } catch {
      /* leave list as-is */
    }
  }, []);

  useEffect(() => {
    if (data?.profileId) void loadDocs(data.profileId);
  }, [data?.profileId, loadDocs]);

  const saveDraft = useCallback(async () => {
    if (!data || !draft || draft.saving) return;
    setDraft((d) => (d ? { ...d, saving: true } : d));
    try {
      await governanceApi.generateDocument(data.profileId, draft.type, true);
      const fresh = await governanceApi.assess(data.profileId);
      setData((cur) => (cur ? { ...cur, assessment: fresh } : cur));
      setDraft((d) => (d ? { ...d, saving: false, saved: true } : d));
      void loadDocs(data.profileId);
    } catch {
      setDraft((d) => (d ? { ...d, saving: false } : d));
    }
  }, [data, draft, loadDocs]);

  const openSaved = useCallback(
    async (doc: GovernanceDocumentRef) => {
      if (!data) return;
      setDraft({
        type: doc.type,
        title: doc.title,
        content: '',
        loading: true,
        saving: false,
        saved: true,
      });
      try {
        const full = await governanceApi.getDocument(data.profileId, doc.id);
        setDraft((d) => (d ? { ...d, loading: false, content: full.content } : d));
      } catch {
        setDraft((d) =>
          d ? { ...d, loading: false, content: 'Could not load this document.' } : d,
        );
      }
    },
    [data],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b pb-3">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Ask
        </button>
        <span className="mx-1 text-muted-foreground">/</span>
        <ShieldCheck className="h-4 w-4 text-ai" />
        <h1 className="truncate text-lg font-semibold">Governance · {product}</h1>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto py-5"
        data-lenis-prevent
      >
        {loading ? (
          <div className="pt-10">
            <Thinking label={`Assessing ${product} across jurisdictions…`} />
          </div>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : data ? (
          <>
            <ScoreStrip scores={data.assessment.scores} />
            <Answer answer={data.answer} sources={data.sources} busy={busy} />
            <MissingInfo assessment={data.assessment} onAnswer={answerMissing} />
            <Blockers assessment={data.assessment} />
            <Laws assessment={data.assessment} />
            <Gaps assessment={data.assessment} onGenerate={previewDoc} />
            <SavedDocs docs={docs} onOpen={openSaved} />
            <Actions assessment={data.assessment} />
          </>
        ) : null}
      </div>

      {draft && (
        <DocDraftModal
          draft={draft}
          onRegenerate={() => void previewDoc(draft.type, draft.title)}
          onSave={() => void saveDraft()}
          onClose={() => setDraft(null)}
        />
      )}

      {data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = followUp.trim();
            if (q) {
              void ask(q);
              setFollowUp('');
            }
          }}
          className="flex items-center gap-2 border-t pt-3"
        >
          <div className="flex flex-1 items-center gap-2 rounded-2xl border bg-card px-4 py-2 focus-within:border-ai/40">
            <Sparkles className="h-5 w-5 shrink-0 text-ai" />
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="Ask e.g. “Can we launch in Germany?”, “Do we need HIPAA?”"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={busy || !followUp.trim()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ai-gradient text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ── Sections ───────────────────────────────────────────────────── */

function sevTone(s: Sev): 'danger' | 'warning' | 'neutral' {
  return s === 'CRITICAL' || s === 'HIGH' ? 'danger' : s === 'MEDIUM' ? 'warning' : 'neutral';
}

function ScoreStrip({ scores }: { scores: GovernanceAssessment['scores'] }) {
  const items: [string, number][] = [
    ['Launch readiness', scores.launchReadiness],
    ['Overall', scores.overall],
    ['Risk', scores.risk],
    ['Privacy', scores.privacy],
    ['Security', scores.security],
    ['Compliance', scores.compliance],
    ['AI', scores.aiGovernance],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
      {items.map(([label, v]) => (
        <div key={label} className="rounded-xl border bg-card px-2 py-2.5 text-center">
          <div
            className={`text-lg font-semibold ${label === 'Risk' ? (v >= 50 ? 'text-danger' : 'text-foreground') : ''}`}
          >
            {v}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

type Source = GovernanceAnswer['sources'][number];

function Answer({ answer, sources, busy }: { answer: string; sources: Source[]; busy: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <FormattedAnswer text={answer} sources={sources} />
      {busy && (
        <div className="mt-2">
          <Thinking label="Re-evaluating" />
        </div>
      )}
    </div>
  );
}

/**
 * Lightweight Markdown renderer for the governance answer (the app ships no
 * markdown lib). Handles headings, bold, and bullet/numbered lists, and turns
 * inline `[n]` markers into citation chips mapped to the retrieved sources.
 */
function FormattedAnswer({ text, sources }: { text: string; sources: Source[] }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it, sources)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key++} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key++} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) {
        flush();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]!);
      continue;
    }
    if (numbered) {
      if (!list || !list.ordered) {
        flush();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]!);
      continue;
    }
    flush();
    if (line.trim() === '') continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/) ?? line.match(/^\*\*(.+?)\*\*:?$/);
    if (heading) {
      blocks.push(
        <p key={key++} className="mt-3 text-sm font-semibold first:mt-0">
          {renderInline(heading[1]!, sources)}
        </p>,
      );
    } else {
      blocks.push(
        <p key={key++} className="text-sm leading-relaxed">
          {renderInline(line, sources)}
        </p>,
      );
    }
  }
  flush();

  return <div className="space-y-2">{blocks}</div>;
}

/** Inline formatting: `**bold**` and `[n]` citation chips. */
function renderInline(text: string, sources: Source[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[(\d+)\]/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(<strong key={key++}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      const n = Number(m[2]);
      const src = sources[n - 1];
      if (src) nodes.push(<Cite key={key++} n={n} source={src} />);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Cite({ n, source }: { n: number; source: Source }) {
  const cls =
    'mx-0.5 rounded bg-ai/10 px-1 align-super text-[10px] font-medium leading-none text-ai transition hover:bg-ai/20';
  const tip = `${source.type}: ${source.title}`;
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" title={tip} className={cls}>
      {n}
    </a>
  ) : (
    <sup title={tip} className={cls}>
      {n}
    </sup>
  );
}

function MissingInfo({
  assessment,
  onAnswer,
}: {
  assessment: GovernanceAssessment;
  onAnswer: (m: GovMissingInfo, options: string[]) => void;
}) {
  if (assessment.missingInfo.length === 0) return null;
  return (
    <Section icon={HelpCircle} title="I need a few details (I won't assume)">
      <div className="space-y-4">
        {assessment.missingInfo.map((m) => (
          <MissingRow key={m.field} m={m} onAnswer={onAnswer} />
        ))}
      </div>
    </Section>
  );
}

/** One missing-info question. Countries & data categories accept several
 * answers (toggle + Confirm); scalar fields submit on click. */
function MissingRow({
  m,
  onAnswer,
}: {
  m: GovMissingInfo;
  onAnswer: (m: GovMissingInfo, options: string[]) => void;
}) {
  const multi = MULTI_FIELDS.has(m.field);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (o: string) =>
    setSelected((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));

  return (
    <div>
      <p className="text-sm">
        {m.question}
        {multi && (
          <span className="ml-1 text-xs text-muted-foreground">(select all that apply)</span>
        )}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {m.options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              onClick={() => (multi ? toggle(o) : onAnswer(m, [o]))}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                on ? 'border-ai bg-ai/10 text-ai' : 'hover:border-ai/50 hover:text-ai'
              }`}
            >
              {multi && on ? '✓ ' : ''}
              {o}
            </button>
          );
        })}
        {multi && (
          <button
            onClick={() => selected.length > 0 && onAnswer(m, selected)}
            disabled={selected.length === 0}
            className="ml-1 rounded-full bg-ai-gradient px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Confirm{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        )}
      </div>
    </div>
  );
}

function Blockers({ assessment }: { assessment: GovernanceAssessment }) {
  if (assessment.launchBlockers.length === 0) return null;
  return (
    <Section icon={ShieldAlert} title={`Launch blockers (${assessment.launchBlockers.length})`}>
      <ul className="space-y-1.5">
        {assessment.launchBlockers.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Badge tone={sevTone(b.severity as Sev)}>{b.severity}</Badge>
            <span>
              <span className="font-medium">{b.title}</span> —{' '}
              <span className="text-muted-foreground">{b.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Laws({ assessment }: { assessment: GovernanceAssessment }) {
  if (assessment.applicableLaws.length === 0) return null;
  return (
    <Section
      icon={Gavel}
      title={`Applicable laws & frameworks (${assessment.applicableLaws.length})`}
    >
      <ul className="space-y-1.5">
        {assessment.applicableLaws.map((l) => (
          <li key={l.lawId} className="flex items-start gap-2 text-sm">
            <Badge tone={l.recommended ? 'neutral' : sevTone(l.severity)}>
              {l.recommended ? 'REC' : l.severity}
            </Badge>
            <span className="min-w-0">
              {l.url ? (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-ai hover:underline"
                >
                  {l.shortName}
                </a>
              ) : (
                <span className="font-medium">{l.shortName}</span>
              )}{' '}
              <span className="text-muted-foreground">— {l.reasons.join('; ')}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Gaps({
  assessment,
  onGenerate,
}: {
  assessment: GovernanceAssessment;
  onGenerate: (type: string, title: string) => void;
}) {
  if (assessment.gaps.length === 0) {
    return (
      <Section icon={FileText} title="Required documents">
        <p className="text-sm text-muted-foreground">All required documents are in place. ✅</p>
      </Section>
    );
  }
  return (
    <Section icon={FileText} title={`Missing documents (${assessment.gaps.length})`}>
      <ul className="space-y-1.5">
        {assessment.gaps.map((g) => (
          <li key={g.id} className="flex items-center gap-2 text-sm">
            <Badge tone={sevTone(g.severity)}>{g.severity}</Badge>
            <span className="min-w-0 flex-1 truncate">
              {g.title} <span className="text-muted-foreground">· {g.requiredBy.join(', ')}</span>
            </span>
            {g.documentType && (
              <button
                onClick={() => onGenerate(g.documentType!, g.title)}
                className="shrink-0 rounded-lg bg-ai-gradient px-2.5 py-1 text-xs font-medium text-white"
              >
                Generate
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Preview modal for a generated document — check it, regenerate, or save (never to Drive). */
function DocDraftModal({
  draft,
  onRegenerate,
  onSave,
  onClose,
}: {
  draft: DraftState;
  onRegenerate: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const ghost =
    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition hover:border-ai/50 hover:text-ai disabled:opacity-40';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border bg-card shadow-elevation-mid"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <FileText className="h-4 w-4 text-ai" />
          <h2 className="flex-1 truncate text-sm font-semibold">{draft.title}</h2>
          <Badge tone={draft.saved ? 'success' : 'neutral'}>
            {draft.saved ? 'Saved draft' : 'Preview — not saved'}
          </Badge>
          <button onClick={onClose} className="ml-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-lenis-prevent>
          {draft.loading ? (
            <Thinking label="Drafting the document…" />
          ) : (
            <FormattedAnswer text={draft.content} sources={[]} />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">
            Not saved to Drive. “Save draft” keeps a copy in the app.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => void copy()} disabled={draft.loading} className={ghost}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </button>
            <button
              onClick={onRegenerate}
              disabled={draft.loading || draft.saving}
              className={ghost}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </button>
            <button
              onClick={onSave}
              disabled={draft.loading || draft.saving || draft.saved}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ai-gradient px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {draft.saved ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Saved
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" /> {draft.saving ? 'Saving…' : 'Save draft'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Saved document drafts — click to reopen in the viewer. */
function SavedDocs({
  docs,
  onOpen,
}: {
  docs: GovernanceDocumentRef[];
  onOpen: (doc: GovernanceDocumentRef) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <Section icon={FileText} title={`Saved documents (${docs.length})`}>
      <ul className="space-y-1.5">
        {docs.map((d) => (
          <li key={d.id}>
            <button
              onClick={() => onOpen(d)}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm transition hover:bg-muted/50"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-ai" />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(d.createdAt).toLocaleDateString()}
              </span>
              <Badge tone="neutral">{d.status.toLowerCase()}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Actions({ assessment }: { assessment: GovernanceAssessment }) {
  if (assessment.recommendedActions.length === 0) return null;
  return (
    <Section icon={ShieldCheck} title="Recommended actions">
      <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
        {assessment.recommendedActions.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </Section>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Gavel;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}
