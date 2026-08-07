'use client';

import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** `useLayoutEffect` warns during SSR; the measurement pass only has meaning in
 *  the browser anyway. */
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
import type { ArtDirection, DiagramEdge, DiagramNode } from '@company-brain/studio';
import { Eyebrow, Headline, Lede, Reveal, SourceTag, type SceneProps } from '../atoms';
import { SceneShell } from '../scene-shell';
import { useReducedMotionSafe } from '../lib/motion';

/**
 * Diagram scenes.
 *
 * Architecture is drawn, not illustrated: edges stroke themselves in as the
 * scene enters, pulses travel the flow, and hovering a node focuses its
 * neighbourhood while everything else recedes. That focus behaviour is what
 * makes a system diagram legible — a static graph with twelve labels is noise,
 * the same graph with one neighbourhood lit is an explanation.
 *
 * Edges are SVG (crisp curves, animatable stroke) while nodes are HTML
 * positioned over the top (real typography, real focus rings, real hit areas).
 * `foreignObject` would have unified them and broken both.
 */

interface DiagramProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  art: ArtDirection;
  durationMs: number;
  staggerMs: number;
  easing: [number, number, number, number];
  variant: 'flow' | 'graph';
}

interface Point {
  x: number;
  y: number;
}
interface Box extends Point {
  w: number;
  h: number;
}

/**
 * Push overlapping nodes apart.
 *
 * The composer's layout places nodes on a clean grid or ring, but it works in
 * abstract 0..1 space and cannot know how wide a rendered label will be — so a
 * node captioned "Resolve gaps and test internally" happily lands on top of its
 * neighbour. This relaxes the real, measured boxes until they no longer collide,
 * which is only possible once the DOM has told us their sizes.
 */
function relaxCollisions(boxes: Box[], bounds: { w: number; h: number }, gap = 18): Box[] {
  const out = boxes.map((box) => ({ ...box }));
  for (let pass = 0; pass < 60; pass += 1) {
    let moved = false;
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i]!;
        const b = out[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 + gap - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        moved = true;
        // Resolve along the shallower axis — the smaller correction preserves
        // the layout's intent (a flow stays left-to-right, a ring stays round).
        if (overlapX < overlapY) {
          const shift = (overlapX / 2) * (dx < 0 ? -1 : 1);
          a.x -= shift;
          b.x += shift;
        } else {
          const shift = (overlapY / 2) * (dy < 0 ? -1 : 1);
          a.y -= shift;
          b.y += shift;
        }
      }
    }
    if (!moved) break;
  }

  // Keep everything inside the frame.
  for (const box of out) {
    box.x = Math.max(box.w / 2 + 2, Math.min(bounds.w - box.w / 2 - 2, box.x));
    box.y = Math.max(box.h / 2 + 2, Math.min(bounds.h - box.h / 2 - 2, box.y));
  }
  return out;
}

/** Where a ray leaving `box`'s centre toward `target` crosses the box edge. */
function edgeAnchor(box: Box, target: Point, gap = 6): Point {
  const dx = target.x - box.x;
  const dy = target.y - box.y;
  if (dx === 0 && dy === 0) return { x: box.x, y: box.y };
  const hw = box.w / 2 + gap;
  const hh = box.h / 2 + gap;
  // Scale the direction until it hits whichever edge it reaches first.
  const scale = Math.min(
    Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity,
  );
  return { x: box.x + dx * scale, y: box.y + dy * scale };
}

/**
 * Curved connector between two measured boxes, in real pixel coordinates.
 *
 * The previous version drew into a `viewBox="0 0 100 100"` with
 * `preserveAspectRatio="none"`. On a 1000×400 frame that stretches x by 10 and y
 * by 4, so a control point offset perpendicular to the run in "100-space" came
 * out wildly skewed — the curves ballooned off-frame and only fragments of them
 * were visible. Working in pixels keeps the geometry honest.
 */
function edgePath(from: Box, to: Box, curvature: number): string {
  const start = edgeAnchor(from, to);
  const end = edgeAnchor(to, from);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  // Bow proportional to the run, capped so long edges don't sag across the frame.
  const bow = Math.min(curvature, length * 0.12);
  const cx = (start.x + end.x) / 2 + (-dy / length) * bow;
  const cy = (start.y + end.y) / 2 + (dx / length) * bow;
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function Diagram({ nodes, edges, art, durationMs, staggerMs, easing, variant }: DiagramProps) {
  const reduced = useReducedMotionSafe();
  const [focus, setFocus] = useState<string | null>(null);

  /** Nodes one hop from the focused node — the "neighbourhood" kept lit. */
  const neighbourhood = useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const edge of edges) {
      if (edge.from === focus) set.add(edge.to);
      if (edge.to === focus) set.add(edge.from);
    }
    return set;
  }, [edges, focus]);

  /** Stable colour per group, so the same group reads the same across scenes. */
  const groupColor = useMemo(() => {
    const groups = [...new Set(nodes.map((node) => node.group).filter(Boolean))] as string[];
    const ramp = [art.accent, art.accentAlt, art.ink];
    return new Map(groups.map((group, index) => [group, ramp[index % ramp.length]!] as const));
  }, [art, nodes]);

  const colorFor = (node: DiagramNode): string => {
    if (node.group && groupColor.has(node.group)) return groupColor.get(node.group)!;
    return node.emphasis === 'primary' ? art.accent : art.ink;
  };

  const dimmed = (id: string) => Boolean(neighbourhood && !neighbourhood.has(id));

  // ── Real geometry ──────────────────────────────────────────────────────────
  // Everything below works in measured pixels. Node boxes are laid out by the
  // browser (so their size reflects the actual text), then read back, relaxed
  // apart, and used to place both the boxes and the connectors. Edges cannot be
  // drawn correctly until the boxes have been measured, so the first paint
  // renders nodes only and the connectors appear on the following frame.
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});

  /**
   * Measure synchronously after layout.
   *
   * Deliberately NOT relying on ResizeObserver for the first measurement: an
   * observer only delivers at the end of a rendered frame, so in a tab that is
   * hidden or throttled it may not fire for a long time — and the connectors,
   * which cannot be drawn without a frame size, would simply never appear. A
   * layout-effect read is available immediately and is correct on first paint.
   */
  useMeasureEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width && height && (width !== frame.w || height !== frame.h)) {
      setFrame({ w: width, h: height });
    }

    const measured: Record<string, { w: number; h: number }> = {};
    for (const node of nodes) {
      const box = nodeRefs.current.get(node.id);
      if (box) measured[node.id] = { w: box.offsetWidth, h: box.offsetHeight };
    }
    setSizes((previous) => {
      const changed = nodes.some((node) => {
        const next = measured[node.id];
        const prev = previous[node.id];
        return !prev || !next || prev.w !== next.w || prev.h !== next.h;
      });
      return changed ? measured : previous;
    });
  }, [frame.w, frame.h, nodes]);

  // The observer then keeps it honest through viewport resizes and font swaps.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width && height) setFrame({ w: width, h: height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Final, collision-free pixel positions keyed by node id. */
  const placed = useMemo(() => {
    if (!frame.w || !frame.h) return new Map<string, Box>();
    const boxes: Box[] = nodes.map((node) => ({
      x: (node.x ?? 0.5) * frame.w,
      y: (node.y ?? 0.5) * frame.h,
      w: sizes[node.id]?.w ?? 120,
      h: sizes[node.id]?.h ?? 44,
    }));
    const relaxed = relaxCollisions(boxes, frame, variant === 'graph' ? 20 : 26);
    return new Map(nodes.map((node, index) => [node.id, relaxed[index]!] as const));
  }, [frame, nodes, sizes, variant]);

  const ready = placed.size > 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{
        // Height, not aspect-ratio: a diagram sized by ratio grows with the
        // container and pushes itself below the fold on short viewports, which
        // silently breaks the one-scene-one-screen promise.
        height: variant === 'graph' ? 'clamp(300px, 54svh, 620px)' : 'clamp(260px, 46svh, 540px)',
      }}
      onMouseLeave={() => setFocus(null)}
    >
      {ready && (
        <svg
          // A 1:1 pixel viewBox. Anything else (notably `preserveAspectRatio="none"`)
          // scales x and y differently and shears every curve.
          viewBox={`0 0 ${frame.w} ${frame.h}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          {edges.map((edge, index) => {
            const from = placed.get(edge.from);
            const to = placed.get(edge.to);
            if (!from || !to) return null;
            const path = edgePath(from, to, variant === 'graph' ? 26 : 40);
            const isDim = dimmed(edge.from) && dimmed(edge.to);
            const active = Boolean(neighbourhood) && !isDim;

            return (
              <g key={`${edge.from}-${edge.to}-${index}`}>
                <motion.path
                  d={path}
                  fill="none"
                  stroke={active ? art.accent : art.ink}
                  strokeWidth={active ? 1.6 : 1}
                  strokeLinecap="round"
                  initial={
                    reduced ? { pathLength: 1, opacity: 0.22 } : { pathLength: 0, opacity: 0 }
                  }
                  whileInView={{ pathLength: 1, opacity: isDim ? 0.07 : active ? 0.6 : 0.24 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{
                    pathLength: {
                      duration: reduced ? 0 : durationMs / 1000,
                      ease: easing,
                      delay: reduced ? 0 : (index * staggerMs) / 1000,
                    },
                    opacity: { duration: 0.35 },
                  }}
                />
                {/* Travelling pulse: only on directed flow edges, and never more
                    than a handful at once, or it becomes a screensaver. */}
                {edge.kind !== 'link' && !reduced && index < 6 && (
                  <motion.circle
                    r={3}
                    fill={art.accent}
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: isDim ? 0 : 0.85 }}
                    viewport={{ once: true }}
                    style={{ offsetPath: `path("${path}")`, offsetRotate: '0deg' }}
                    animate={{ offsetDistance: ['0%', '100%'] }}
                    transition={{
                      offsetDistance: {
                        duration: 2.6,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: 1 + index * 0.45,
                      },
                      opacity: { duration: 0.4 },
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}

      {nodes.map((node, index) => {
        const isDim = dimmed(node.id);
        const color = colorFor(node);
        const primary = node.emphasis === 'primary';
        const box = placed.get(node.id);

        return (
          <motion.div
            key={node.id}
            ref={(element) => {
              if (element) nodeRefs.current.set(node.id, element);
              else nodeRefs.current.delete(node.id);
            }}
            initial={reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.82 }}
            whileInView={{ opacity: isDim ? 0.28 : 1, scale: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{
              duration: reduced ? 0 : durationMs / 1400,
              ease: easing,
              delay: reduced ? 0 : (index * staggerMs) / 1000,
              opacity: { duration: 0.35 },
            }}
            onMouseEnter={() => setFocus(node.id)}
            onFocus={() => setFocus(node.id)}
            onBlur={() => setFocus(null)}
            tabIndex={0}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-default outline-none"
            style={
              box
                ? { left: box.x, top: box.y }
                : // Pre-measurement pass: place from the abstract layout so the
                  // browser can size the box, then the effect above corrects it.
                  { left: `${(node.x ?? 0.5) * 100}%`, top: `${(node.y ?? 0.5) * 100}%` }
            }
          >
            <div
              className="max-w-[min(38vw,190px)] px-4 py-3 text-center transition-shadow"
              style={{
                borderRadius: 'var(--story-radius)',
                border: `1px solid ${primary ? color : 'var(--scene-line)'}`,
                background: primary
                  ? `color-mix(in oklab, ${color} 15%, var(--scene-bg))`
                  : 'color-mix(in oklab, var(--scene-bg) 82%, var(--scene-ink) 4%)',
                backdropFilter: 'blur(6px)',
                boxShadow: focus === node.id ? `0 0 0 1px ${color}` : 'none',
              }}
            >
              <div
                className="text-[0.78rem] font-medium leading-tight sm:text-[0.86rem]"
                style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink)' }}
              >
                {node.label}
              </div>
              {node.caption && (
                <div
                  className="mt-1 text-[0.66rem] leading-snug opacity-60"
                  style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink)' }}
                >
                  {node.caption}
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Architecture ─────────────────────────────────────────────────────────────

export function ArchitectureScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const nodes = scene.nodes ?? [];
  const edges = scene.edges ?? [];

  return (
    <SceneShell scene={scene} art={art} align="start">
      <div className="max-w-2xl">
        <Reveal motion={scene.motion}>
          <Eyebrow className="mb-7">{scene.eyebrow}</Eyebrow>
          <Headline size="title" className="max-w-[20ch]">
            {scene.title}
          </Headline>
        </Reveal>
        {scene.body && (
          <Reveal motion={scene.motion} index={1}>
            <div className="mt-6 max-w-xl">
              <Lede>{scene.body}</Lede>
            </div>
          </Reveal>
        )}
      </div>

      <div className="mt-10">
        <Diagram
          nodes={nodes}
          edges={edges}
          art={art}
          durationMs={scene.motion.durationMs}
          staggerMs={scene.motion.staggerMs}
          easing={scene.motion.easing}
          variant="flow"
        />
      </div>

      <p
        className="mt-6 text-[0.68rem] uppercase tracking-[0.2em] opacity-35"
        style={{ fontFamily: 'var(--story-body)' }}
      >
        Hover a node to trace its connections
      </p>

      <SourceTag sources={scene.sources} />
    </SceneShell>
  );
}

// ── Knowledge graph ──────────────────────────────────────────────────────────

/** The knowledge graph, building itself. Same engine as architecture with a
 *  radial layout and grouped colour — one component, two directed behaviours. */
export function GraphScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const nodes = scene.nodes ?? [];
  const edges = scene.edges ?? [];
  const groups = [...new Set(nodes.map((node) => node.group).filter(Boolean))] as string[];

  return (
    <SceneShell scene={scene} art={art} align="start">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-16">
        <div>
          <Reveal motion={scene.motion}>
            <Eyebrow className="mb-7">{scene.eyebrow}</Eyebrow>
            <Headline size="title" className="max-w-[20ch]">
              {scene.title}
            </Headline>
          </Reveal>
          {scene.body && (
            <Reveal motion={scene.motion} index={1}>
              <div className="mt-6 max-w-xl">
                <Lede>{scene.body}</Lede>
              </div>
            </Reveal>
          )}

          {groups.length > 1 && (
            <Reveal motion={scene.motion} index={2}>
              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2.5">
                {groups.map((group, index) => (
                  <li
                    key={group}
                    className="flex items-center gap-2 text-[0.74rem] uppercase tracking-[0.14em]"
                    style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink-muted)' }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: [art.accent, art.accentAlt, art.ink][index % 3] }}
                    />
                    {group}
                  </li>
                ))}
              </ul>
            </Reveal>
          )}

          <SourceTag sources={scene.sources} />
        </div>

        <Diagram
          nodes={nodes}
          edges={edges}
          art={art}
          durationMs={scene.motion.durationMs}
          staggerMs={scene.motion.staggerMs}
          easing={scene.motion.easing}
          variant="graph"
        />
      </div>
    </SceneShell>
  );
}
