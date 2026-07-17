'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/** Stable color per entity type (hash → hue). */
export function typeColor(type: string): string {
  let hash = 0;
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 65% 55%)`;
}

export interface GraphViewNode {
  id: string;
  type: string;
  title: string;
  confidence?: number;
  mentionCount?: number;
}
export interface GraphViewEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence?: number;
  isInferred?: boolean;
}
export interface GraphViewData {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
}

interface SimNode {
  id: string;
  type: string;
  title: string;
  weight: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphViewProps {
  data: GraphViewData;
  height?: number;
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
  onExpand?: (nodeId: string) => void;
}

/**
 * Dependency-free force-directed graph explorer rendered as SVG. Supports
 * pan (drag) + zoom (wheel), neighbor highlighting on hover/select, a minimap,
 * confidence-weighted edges and animated "marching-ants" inferred edges. Click
 * selects a node; double-click expands it (loads its neighborhood).
 */
export function GraphView({ data, height = 600, selectedId, onSelect, onExpand }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, data.nodes.length);
      const radius = Math.min(width, height) * 0.35;
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        weight: n.mentionCount ?? Math.max(1, Math.round((n.confidence ?? 0.5) * 6)),
        x: width / 2 + radius * Math.cos(angle),
        y: height / 2 + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = data.edges.filter((e) => byId.has(e.from) && byId.has(e.to));

    const TICKS = 240;
    const REPULSION = 5200;
    const SPRING = 0.02;
    const SPRING_LENGTH = 110;
    const CENTER = 0.015;
    const DAMPING = 0.85;

    for (let tick = 0; tick < TICKS; tick += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            dist2 = 1;
          }
          const force = REPULSION / dist2;
          const dist = Math.sqrt(dist2);
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
          b.vx -= (dx / dist) * force;
          b.vy -= (dy / dist) * force;
        }
      }
      for (const edge of edges) {
        const a = byId.get(edge.from)!;
        const b = byId.get(edge.to)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = SPRING * (dist - SPRING_LENGTH);
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }
      for (const node of nodes) {
        node.vx += (width / 2 - node.x) * CENTER;
        node.vy += (height / 2 - node.y) * CENTER;
        node.vx *= DAMPING;
        node.vy *= DAMPING;
        node.x = Math.min(width - 20, Math.max(20, node.x + node.vx));
        node.y = Math.min(height - 20, Math.max(20, node.y + node.vy));
      }
    }
    return { nodes, byId, edges };
  }, [data, width, height]);

  const neighborhood = useMemo(() => {
    const focus = hovered ?? selectedId;
    if (!focus) return null;
    const linked = new Set<string>([focus]);
    for (const edge of layout.edges) {
      if (edge.from === focus) linked.add(edge.to);
      if (edge.to === focus) linked.add(edge.from);
    }
    return linked;
  }, [hovered, selectedId, layout.edges]);

  function onWheel(event: React.WheelEvent) {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const k = Math.min(4, Math.max(0.25, v.k * factor));
      // Zoom around the cursor.
      return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
    });
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-lg border bg-card"
      style={{ height }}
    >
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Knowledge graph"
        className="cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setView((v) => ({
            ...v,
            x: drag.current!.vx + (e.clientX - drag.current!.x),
            y: drag.current!.vy + (e.clientY - drag.current!.y),
          }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {layout.edges.map((edge) => {
            const a = layout.byId.get(edge.from)!;
            const b = layout.byId.get(edge.to)!;
            const dimmed =
              neighborhood && !(neighborhood.has(edge.from) && neighborhood.has(edge.to));
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const confidence = edge.confidence ?? 0.6;
            return (
              <g key={edge.id} opacity={dimmed ? 0.1 : 0.3 + confidence * 0.6}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={edge.isInferred ? 'hsl(265 70% 60%)' : 'currentColor'}
                  strokeWidth={edge.isInferred ? 1 : 0.6 + confidence}
                  strokeDasharray={edge.isInferred ? '4 3' : undefined}
                  className={edge.isInferred ? '' : 'text-muted-foreground'}
                >
                  {edge.isInferred && (
                    <animate
                      attributeName="stroke-dashoffset"
                      from="0"
                      to="-14"
                      dur="0.7s"
                      repeatCount="indefinite"
                    />
                  )}
                </line>
                {view.k > 0.7 && (
                  <text
                    x={midX}
                    y={midY - 3}
                    textAnchor="middle"
                    fontSize={8}
                    className="fill-muted-foreground select-none"
                  >
                    {edge.type}
                  </text>
                )}
              </g>
            );
          })}
          {layout.nodes.map((node) => {
            const dimmed = neighborhood && !neighborhood.has(node.id);
            const r = Math.min(20, 7 + Math.sqrt(node.weight) * 2.2);
            const selected = node.id === selectedId;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                opacity={dimmed ? 0.22 : 1}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect?.(node.id)}
                onDoubleClick={() => onExpand?.(node.id)}
              >
                <circle
                  r={r}
                  fill={typeColor(node.type)}
                  stroke={selected ? 'currentColor' : 'white'}
                  strokeWidth={selected ? 3 : 1}
                  className="text-foreground"
                />
                {view.k > 0.55 && (
                  <text
                    y={r + 11}
                    textAnchor="middle"
                    fontSize={10}
                    className="fill-foreground select-none"
                  >
                    {node.title.length > 24 ? `${node.title.slice(0, 24)}…` : node.title}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Minimap */}
      <div className="pointer-events-none absolute bottom-2 right-2 h-24 w-32 overflow-hidden rounded border bg-background/80">
        <svg width={128} height={96} viewBox={`0 0 ${width} ${height}`}>
          {layout.nodes.map((n) => (
            <circle key={n.id} cx={n.x} cy={n.y} r={6} fill={typeColor(n.type)} />
          ))}
        </svg>
      </div>

      {/* Zoom hint / reset */}
      <button
        onClick={() => setView({ x: 0, y: 0, k: 1 })}
        className="absolute left-2 top-2 rounded border bg-background/80 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Reset view · {Math.round(view.k * 100)}%
      </button>
    </div>
  );
}
