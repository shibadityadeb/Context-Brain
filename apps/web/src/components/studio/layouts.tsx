'use client';

import type { ReactNode } from 'react';
import type {
  Column,
  ImageRef,
  LayoutId,
  Metric,
  SlideContent,
  TimelineItem,
} from '@company-brain/studio';
import { EditableImage, EditableText } from './editable';

/**
 * The layout catalogue as responsive React + Tailwind components. Each slide is
 * just HTML (no canvas/SVG), reads theme tokens via `var(--studio-*)`, and binds
 * its fields to the content model for inline editing. Adding a layout = adding a
 * component here + a registry entry in `@company-brain/studio` (the AI's menu).
 */

export interface LayoutProps {
  content: SlideContent;
  editable: boolean;
  onPatch: (patch: Partial<SlideContent>) => void;
  resolveImage: (ref?: ImageRef) => string | undefined;
  onReplaceImage?: (slot: number) => void;
}

// ── shared building blocks ────────────────────────────────────────────────────

function Pad({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex h-full w-full flex-col px-[7%] py-[7%] ${className}`}>{children}</div>
  );
}

function Eyebrow({ content, editable, onPatch }: LayoutProps) {
  if (!content.eyebrow && !editable) return null;
  return (
    <EditableText
      as="div"
      value={content.eyebrow ?? ''}
      editable={editable}
      placeholder="Eyebrow"
      onCommit={(v) => onPatch({ eyebrow: v })}
      className="mb-3 text-[1.1em] font-semibold uppercase tracking-[0.18em]"
      // color via inline style token
    />
  );
}

function Title({
  content,
  editable,
  onPatch,
  className = '',
}: LayoutProps & { className?: string }) {
  return (
    <EditableText
      as="h1"
      value={content.title ?? ''}
      editable={editable}
      placeholder="Title"
      onCommit={(v) => onPatch({ title: v })}
      className={`font-semibold leading-[1.08] tracking-tight ${className}`}
    />
  );
}

function Subtitle({
  content,
  editable,
  onPatch,
  className = '',
}: LayoutProps & { className?: string }) {
  if (!content.subtitle && !editable) return null;
  return (
    <EditableText
      as="p"
      value={content.subtitle ?? ''}
      editable={editable}
      multiline
      placeholder="Subtitle"
      onCommit={(v) => onPatch({ subtitle: v })}
      className={`leading-snug ${className}`}
      // muted
    />
  );
}

const muted = { color: 'var(--studio-muted)' } as const;
const primary = { color: 'var(--studio-primary)' } as const;
const cardStyle = {
  background: 'var(--studio-surface)',
  borderColor: 'var(--studio-border)',
  borderRadius: 'var(--studio-radius)',
} as const;

function Header(props: LayoutProps) {
  return (
    <div className="mb-[4%]">
      <div style={primary}>
        <Eyebrow {...props} />
      </div>
      <Title {...props} className="text-[2.6em]" />
      <div style={muted}>
        <Subtitle {...props} className="mt-2 text-[1.15em]" />
      </div>
    </div>
  );
}

function updateArray<T>(arr: T[] | undefined, i: number, v: T): T[] {
  const next = [...(arr ?? [])];
  next[i] = v;
  return next;
}

// ── layouts ───────────────────────────────────────────────────────────────────

function Cover(props: LayoutProps) {
  const { content, resolveImage } = props;
  const bg = resolveImage(content.images?.[0]);
  return (
    <div className="relative h-full w-full">
      {bg && (
        <>
          <EditableImage
            url={bg}
            editable={props.editable}
            onReplace={() => props.onReplaceImage?.(0)}
            rounded={false}
          />
          <div className="absolute inset-0 bg-black/45" />
        </>
      )}
      <div
        className={`absolute inset-0 flex flex-col justify-center px-[8%] ${bg ? 'text-white' : ''}`}
      >
        <div style={bg ? { color: '#fff' } : primary}>
          <Eyebrow {...props} />
        </div>
        <Title {...props} className="text-[4em] max-w-[85%]" />
        <div style={bg ? { color: 'rgba(255,255,255,0.85)' } : muted}>
          <Subtitle {...props} className="mt-5 text-[1.5em] max-w-[70%]" />
        </div>
      </div>
    </div>
  );
}

function Hero(props: LayoutProps) {
  return (
    <Pad className="items-center justify-center text-center">
      <Title {...props} className="text-[3.4em] max-w-[90%]" />
      <div style={muted}>
        <Subtitle {...props} className="mt-6 text-[1.4em] max-w-[75%]" />
      </div>
    </Pad>
  );
}

function Statement(props: LayoutProps) {
  return (
    <Pad className="relative items-center justify-center overflow-hidden text-center">
      <div
        className="absolute left-[12%] top-[16%] h-32 w-32 rounded-full opacity-20 blur-3xl"
        style={{ background: 'var(--studio-accent)' }}
      />
      <div style={primary}>
        <Eyebrow {...props} />
      </div>
      <Title {...props} className="relative max-w-[88%] text-[4.4em]" />
      <div style={muted}>
        <Subtitle {...props} className="mt-7 max-w-[65%] text-[1.25em]" />
      </div>
    </Pad>
  );
}

function Pause(props: LayoutProps) {
  return (
    <Pad className="items-center justify-center text-center">
      <Title {...props} className="max-w-[80%] text-[5em] font-medium" />
      <div className="mt-10 h-px w-16" style={{ background: 'var(--studio-primary)' }} />
      <div style={muted}>
        <Subtitle {...props} className="mt-7 text-[1.1em]" />
      </div>
    </Pad>
  );
}

function Chapter(props: LayoutProps) {
  return (
    <Pad className="justify-end pb-[12%]">
      <div className="mb-7 flex items-center gap-3" style={primary}>
        <span className="h-px w-12" style={{ background: 'currentColor' }} />
        <Eyebrow {...props} />
      </div>
      <Title {...props} className="max-w-[75%] text-[4.2em]" />
      <div style={muted}>
        <Subtitle {...props} className="mt-5 max-w-[55%] text-[1.2em]" />
      </div>
    </Pad>
  );
}

function Spotlight(props: LayoutProps) {
  const image = props.resolveImage(props.content.images?.[0]);
  return (
    <div className="relative h-full w-full overflow-hidden">
      {image ? (
        <EditableImage
          url={image}
          editable={props.editable}
          onReplace={() => props.onReplaceImage?.(0)}
          rounded={false}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: 'var(--studio-surface)' }} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
      <div className="absolute inset-x-[8%] bottom-[10%] text-white">
        <Eyebrow {...props} />
        <Title {...props} className="mt-3 max-w-[75%] text-[3.6em]" />
        <Subtitle {...props} className="mt-4 max-w-[55%] text-[1.15em] text-white/75" />
      </div>
    </div>
  );
}

function Journey(props: LayoutProps) {
  const steps = props.content.timeline ?? [];
  return (
    <Pad>
      <Header {...props} />
      <div className="relative mt-auto grid grid-cols-1 gap-3 md:grid-cols-4">
        <div
          className="absolute left-4 right-4 top-5 hidden h-px md:block"
          style={{ background: 'var(--studio-border)' }}
        />
        {steps.map((step, i) => (
          <div key={i} className="relative">
            <span
              className="mb-5 grid h-10 w-10 place-items-center rounded-full text-sm font-semibold"
              style={{ background: 'var(--studio-primary)', color: 'var(--studio-on-primary)' }}
            >
              {step.marker ?? String(i + 1).padStart(2, '0')}
            </span>
            <div className="text-[1.35em] font-semibold">{step.title}</div>
            {step.description && (
              <p className="mt-2 text-[1em] leading-snug" style={muted}>
                {step.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </Pad>
  );
}

function Flow(props: LayoutProps) {
  const nodes = props.content.columns ?? [];
  return (
    <Pad>
      <Header {...props} />
      <div className="mt-auto flex items-stretch gap-3">
        {nodes.map((node, i) => (
          <div key={i} className="flex min-w-0 flex-1 items-center gap-3">
            <div
              className="flex min-h-36 flex-1 flex-col justify-center border p-4"
              style={cardStyle}
            >
              <div className="text-[1.2em] font-semibold">{node.heading}</div>
              {node.body && (
                <p className="mt-2 text-[.95em]" style={muted}>
                  {node.body}
                </p>
              )}
            </div>
            {i < nodes.length - 1 && (
              <span className="text-xl" style={primary}>
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </Pad>
  );
}

function BulletList(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const bullets = content.bullets ?? [];
  return (
    <Pad>
      <Header {...props} />
      <ul className="mt-2 space-y-4">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-3 text-[1.35em] leading-snug">
            <span
              className="mt-[0.5em] h-2 w-2 shrink-0 rounded-full"
              style={{ background: 'var(--studio-primary)' }}
            />
            <EditableText
              value={b.text}
              editable={editable}
              multiline
              placeholder="Point"
              onCommit={(v) => onPatch({ bullets: updateArray(bullets, i, { ...b, text: v }) })}
              className="flex-1"
            />
          </li>
        ))}
      </ul>
      {editable && (
        <button
          type="button"
          onClick={() => onPatch({ bullets: [...bullets, { text: 'New point' }] })}
          className="mt-4 self-start text-sm opacity-60 hover:opacity-100"
          style={primary}
        >
          + Add point
        </button>
      )}
    </Pad>
  );
}

function Columns({ count, ...props }: LayoutProps & { count: number }) {
  const { content, editable, onPatch } = props;
  const cols = content.columns ?? [];
  return (
    <Pad>
      <Header {...props} />
      <div
        className={`mt-2 grid flex-1 gap-5`}
        style={{
          gridTemplateColumns: `repeat(${Math.min(count, Math.max(1, cols.length) || count)}, minmax(0,1fr))`,
        }}
      >
        {(cols.length ? cols : Array.from({ length: count }, (): Column => ({}))).map((col, i) => (
          <div key={i} className="flex flex-col border p-5" style={cardStyle}>
            <div style={primary}>
              <EditableText
                value={col.heading ?? ''}
                editable={editable}
                placeholder="Heading"
                onCommit={(v) => onPatch({ columns: updateArray(cols, i, { ...col, heading: v }) })}
                className="mb-2 text-[1.25em] font-semibold"
              />
            </div>
            <EditableText
              value={col.body ?? ''}
              editable={editable}
              multiline
              placeholder="Describe this column"
              onCommit={(v) => onPatch({ columns: updateArray(cols, i, { ...col, body: v }) })}
              className="text-[1.05em] leading-snug"
            />
          </div>
        ))}
      </div>
    </Pad>
  );
}

function ImageSide({ side, ...props }: LayoutProps & { side: 'left' | 'right' }) {
  const { content, editable, onPatch, resolveImage } = props;
  const url = resolveImage(content.images?.[0]);
  const bullets = content.bullets ?? [];
  const image = (
    <div className="h-full min-h-0 w-full">
      <EditableImage url={url} editable={editable} onReplace={() => props.onReplaceImage?.(0)} />
    </div>
  );
  const text = (
    <div className="flex flex-col justify-center">
      <Title {...props} className="text-[2.2em]" />
      <div style={muted}>
        <Subtitle {...props} className="mt-2 text-[1.15em]" />
      </div>
      {content.body !== undefined || editable ? (
        <EditableText
          value={content.body ?? ''}
          editable={editable}
          multiline
          placeholder="Body"
          onCommit={(v) => onPatch({ body: v })}
          className="mt-4 text-[1.1em] leading-snug"
        />
      ) : null}
      {bullets.length > 0 && (
        <ul className="mt-4 space-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-[1.05em]">
              <span
                className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: 'var(--studio-primary)' }}
              />
              <EditableText
                value={b.text}
                editable={editable}
                onCommit={(v) => onPatch({ bullets: updateArray(bullets, i, { ...b, text: v }) })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="grid h-full w-full grid-cols-2 gap-[5%] px-[6%] py-[6%]">
      {side === 'left' ? (
        <>
          {image}
          {text}
        </>
      ) : (
        <>
          {text}
          {image}
        </>
      )}
    </div>
  );
}

function FullImage(props: LayoutProps) {
  const url = props.resolveImage(props.content.images?.[0]);
  return (
    <div className="relative h-full w-full">
      <EditableImage
        url={url}
        editable={props.editable}
        onReplace={() => props.onReplaceImage?.(0)}
        rounded={false}
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-[6%]">
        <Title {...props} className="text-[2.6em] text-white" />
      </div>
    </div>
  );
}

function Metrics(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const metrics = content.metrics ?? [];
  const setMetric = (i: number, patch: Partial<Metric>) =>
    onPatch({ metrics: updateArray(metrics, i, { ...metrics[i]!, ...patch }) });
  return (
    <Pad>
      <Header {...props} />
      <div
        className="mt-4 grid flex-1 place-content-center gap-6"
        style={{
          gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, metrics.length))}, minmax(0,1fr))`,
        }}
      >
        {metrics.map((m, i) => (
          <div key={i} className="text-center">
            <div style={primary}>
              <EditableText
                value={m.value}
                editable={editable}
                placeholder="00"
                onCommit={(v) => setMetric(i, { value: v })}
                className="text-[3.4em] font-bold leading-none"
              />
            </div>
            <EditableText
              value={m.label}
              editable={editable}
              placeholder="Label"
              onCommit={(v) => setMetric(i, { label: v })}
              className="mt-2 text-[1.1em] font-medium"
            />
            {(m.caption || editable) && (
              <div style={muted}>
                <EditableText
                  value={m.caption ?? ''}
                  editable={editable}
                  placeholder="caption"
                  onCommit={(v) => setMetric(i, { caption: v })}
                  className="mt-1 text-[0.9em]"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Pad>
  );
}

function Timeline({ variant, ...props }: LayoutProps & { variant: 'timeline' | 'roadmap' }) {
  const { content, editable, onPatch } = props;
  const items = content.timeline ?? [];
  const setItem = (i: number, patch: Partial<TimelineItem>) =>
    onPatch({ timeline: updateArray(items, i, { ...items[i]!, ...patch }) });
  return (
    <Pad>
      <Header {...props} />
      <div
        className="mt-2 flex-1 space-y-5 border-l-2 pl-6"
        style={{ borderColor: 'var(--studio-border)' }}
      >
        {items.map((it, i) => (
          <div key={i} className="relative">
            <span
              className="absolute -left-[1.85rem] top-1 h-3.5 w-3.5 rounded-full ring-4"
              style={{
                background: 'var(--studio-primary)',
                ['--tw-ring-color' as string]: 'var(--studio-bg)',
              }}
            />
            <div style={primary}>
              <EditableText
                value={it.marker ?? ''}
                editable={editable}
                placeholder={variant === 'roadmap' ? 'Phase' : 'When'}
                onCommit={(v) => setItem(i, { marker: v })}
                className="text-[0.95em] font-semibold uppercase tracking-wide"
              />
            </div>
            <EditableText
              value={it.title}
              editable={editable}
              placeholder="Milestone"
              onCommit={(v) => setItem(i, { title: v })}
              className="text-[1.3em] font-medium"
            />
            {(it.description || editable) && (
              <div style={muted}>
                <EditableText
                  value={it.description ?? ''}
                  editable={editable}
                  multiline
                  placeholder="Details"
                  onCommit={(v) => setItem(i, { description: v })}
                  className="text-[1.02em]"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Pad>
  );
}

function Comparison(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const cmp = content.comparison ?? { leftLabel: 'Us', rightLabel: 'Them', rows: [] };
  const setRow = (i: number, key: 'label' | 'left' | 'right', v: string) =>
    onPatch({
      comparison: { ...cmp, rows: updateArray(cmp.rows, i, { ...cmp.rows[i]!, [key]: v }) },
    });
  return (
    <Pad>
      <Header {...props} />
      <div
        className="mt-2 grid flex-1 grid-cols-[1.2fr_1fr_1fr] overflow-hidden border"
        style={cardStyle}
      >
        <div />
        <div className="p-3 text-center text-[1.15em] font-semibold" style={primary}>
          <EditableText
            value={cmp.leftLabel}
            editable={editable}
            onCommit={(v) => onPatch({ comparison: { ...cmp, leftLabel: v } })}
            className="text-center"
          />
        </div>
        <div className="p-3 text-center text-[1.15em] font-semibold" style={primary}>
          <EditableText
            value={cmp.rightLabel}
            editable={editable}
            onCommit={(v) => onPatch({ comparison: { ...cmp, rightLabel: v } })}
            className="text-center"
          />
        </div>
        {cmp.rows.map((r, i) => (
          <div key={i} className="contents">
            <div
              className="border-t p-3 text-[1.05em] font-medium"
              style={{ borderColor: 'var(--studio-border)' }}
            >
              <EditableText
                value={r.label}
                editable={editable}
                onCommit={(v) => setRow(i, 'label', v)}
              />
            </div>
            <div
              className="border-t p-3 text-center text-[1.05em]"
              style={{ borderColor: 'var(--studio-border)' }}
            >
              <EditableText
                value={r.left}
                editable={editable}
                onCommit={(v) => setRow(i, 'left', v)}
                className="text-center"
              />
            </div>
            <div
              className="border-t p-3 text-center text-[1.05em]"
              style={{ borderColor: 'var(--studio-border)' }}
            >
              <EditableText
                value={r.right}
                editable={editable}
                onCommit={(v) => setRow(i, 'right', v)}
                className="text-center"
              />
            </div>
          </div>
        ))}
      </div>
    </Pad>
  );
}

function TableLayout(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const table = content.table ?? { headers: [], rows: [] };
  return (
    <Pad>
      <Header {...props} />
      <div className="mt-2 flex-1 overflow-hidden border" style={cardStyle}>
        <table className="w-full border-collapse text-[1.02em]">
          <thead>
            <tr style={{ background: 'var(--studio-primary)', color: 'var(--studio-on-primary)' }}>
              {table.headers.map((h, i) => (
                <th key={i} className="p-3 text-left font-semibold">
                  <EditableText
                    value={h}
                    editable={editable}
                    onCommit={(v) =>
                      onPatch({ table: { ...table, headers: updateArray(table.headers, i, v) } })
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="border-t" style={{ borderColor: 'var(--studio-border)' }}>
                {row.map((cell, c) => (
                  <td key={c} className="p-3">
                    <EditableText
                      value={cell}
                      editable={editable}
                      onCommit={(v) =>
                        onPatch({
                          table: {
                            ...table,
                            rows: updateArray(table.rows, r, updateArray(row, c, v)),
                          },
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Pad>
  );
}

function Quote(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const q = content.quote ?? { text: '' };
  return (
    <Pad className="items-center justify-center text-center">
      <div className="text-[5em] leading-none" style={primary}>
        “
      </div>
      <EditableText
        value={q.text}
        editable={editable}
        multiline
        placeholder="A memorable quote"
        onCommit={(v) => onPatch({ quote: { ...q, text: v } })}
        className="max-w-[85%] text-[2em] font-medium italic leading-snug"
      />
      <div style={muted}>
        <EditableText
          value={q.attribution ?? ''}
          editable={editable}
          placeholder="Attribution"
          onCommit={(v) => onPatch({ quote: { ...q, attribution: v } })}
          className="mt-6 text-[1.15em]"
        />
      </div>
    </Pad>
  );
}

function Team(props: LayoutProps) {
  const { content, editable, onPatch, resolveImage } = props;
  const team = content.team ?? [];
  return (
    <Pad>
      <Header {...props} />
      <div
        className="mt-2 grid flex-1 place-content-center gap-6"
        style={{
          gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, team.length))}, minmax(0,1fr))`,
        }}
      >
        {team.map((m, i) => (
          <div key={i} className="flex flex-col items-center text-center">
            <div className="h-24 w-24 overflow-hidden rounded-full">
              <EditableImage
                url={resolveImage(m.image)}
                editable={editable}
                onReplace={() => props.onReplaceImage?.(i)}
              />
            </div>
            <EditableText
              value={m.name}
              editable={editable}
              placeholder="Name"
              onCommit={(v) => onPatch({ team: updateArray(team, i, { ...m, name: v }) })}
              className="mt-3 text-[1.2em] font-semibold"
            />
            <div style={muted}>
              <EditableText
                value={m.role ?? ''}
                editable={editable}
                placeholder="Role"
                onCommit={(v) => onPatch({ team: updateArray(team, i, { ...m, role: v }) })}
                className="text-[1em]"
              />
            </div>
          </div>
        ))}
      </div>
    </Pad>
  );
}

function Pricing(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const tiers = content.pricing ?? [];
  return (
    <Pad>
      <Header {...props} />
      <div
        className="mt-2 grid flex-1 gap-5"
        style={{
          gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, tiers.length))}, minmax(0,1fr))`,
        }}
      >
        {tiers.map((t, i) => (
          <div
            key={i}
            className="flex flex-col border p-5"
            style={{
              ...cardStyle,
              borderColor: t.highlighted ? 'var(--studio-primary)' : 'var(--studio-border)',
              borderWidth: t.highlighted ? 2 : 1,
            }}
          >
            <EditableText
              value={t.name}
              editable={editable}
              placeholder="Plan"
              onCommit={(v) => onPatch({ pricing: updateArray(tiers, i, { ...t, name: v }) })}
              className="text-[1.2em] font-semibold"
            />
            <EditableText
              value={t.price}
              editable={editable}
              placeholder="$—"
              onCommit={(v) => onPatch({ pricing: updateArray(tiers, i, { ...t, price: v }) })}
              className="mt-1 text-[2em] font-bold"
            />
            <ul className="mt-4 space-y-2 text-[1em]">
              {t.features.map((f, fi) => (
                <li key={fi} className="flex items-start gap-2">
                  <span
                    className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: 'var(--studio-primary)' }}
                  />
                  <EditableText
                    value={f}
                    editable={editable}
                    onCommit={(v) =>
                      onPatch({
                        pricing: updateArray(tiers, i, {
                          ...t,
                          features: updateArray(t.features, fi, v),
                        }),
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Pad>
  );
}

function QA(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const items = content.qa ?? [];
  return (
    <Pad>
      <Header {...props} />
      <div className="mt-2 flex-1 space-y-5">
        {items.map((it, i) => (
          <div key={i}>
            <div className="flex gap-2 text-[1.25em] font-semibold">
              <span style={primary}>Q.</span>
              <EditableText
                value={it.question}
                editable={editable}
                placeholder="Question"
                onCommit={(v) => onPatch({ qa: updateArray(items, i, { ...it, question: v }) })}
                className="flex-1"
              />
            </div>
            {(it.answer || editable) && (
              <div className="mt-1 flex gap-2 text-[1.1em]" style={muted}>
                <span>A.</span>
                <EditableText
                  value={it.answer ?? ''}
                  editable={editable}
                  multiline
                  placeholder="Answer"
                  onCommit={(v) => onPatch({ qa: updateArray(items, i, { ...it, answer: v }) })}
                  className="flex-1"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Pad>
  );
}

function Conclusion(props: LayoutProps) {
  const { content, editable, onPatch } = props;
  const bullets = content.bullets ?? [];
  return (
    <Pad className="justify-center">
      <div style={primary}>
        <Eyebrow {...props} />
      </div>
      <Title {...props} className="text-[3em]" />
      <div style={muted}>
        <Subtitle {...props} className="mt-4 text-[1.35em]" />
      </div>
      {bullets.length > 0 && (
        <ul className="mt-6 space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-[1.25em]">
              <span
                className="mt-[0.5em] h-2 w-2 shrink-0 rounded-full"
                style={{ background: 'var(--studio-primary)' }}
              />
              <EditableText
                value={b.text}
                editable={editable}
                onCommit={(v) => onPatch({ bullets: updateArray(bullets, i, { ...b, text: v }) })}
              />
            </li>
          ))}
        </ul>
      )}
    </Pad>
  );
}

// ── registry ──────────────────────────────────────────────────────────────────

export const LAYOUT_COMPONENTS: Record<LayoutId, (props: LayoutProps) => ReactNode> = {
  cover: Cover,
  hero: Hero,
  statement: Statement,
  pause: Pause,
  chapter: Chapter,
  spotlight: Spotlight,
  journey: Journey,
  flow: Flow,
  'two-column': (p) => <Columns {...p} count={2} />,
  'three-column': (p) => <Columns {...p} count={3} />,
  'image-left': (p) => <ImageSide {...p} side="left" />,
  'image-right': (p) => <ImageSide {...p} side="right" />,
  'full-image': FullImage,
  comparison: Comparison,
  timeline: (p) => <Timeline {...p} variant="timeline" />,
  roadmap: (p) => <Timeline {...p} variant="roadmap" />,
  architecture: (p) => <Columns {...p} count={3} />,
  metrics: Metrics,
  quote: Quote,
  team: Team,
  pricing: Pricing,
  table: TableLayout,
  'bullet-list': BulletList,
  conclusion: Conclusion,
  qa: QA,
};
