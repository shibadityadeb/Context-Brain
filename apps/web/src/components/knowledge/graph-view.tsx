'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraphData } from '@/lib/api';

/** Stable color per entity type (hash → hue). */
export function typeColor(type: string): string {
  let hash = 0;
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 65% 55%)`;
}

interface SimNode {
  id: string;
  type: string;
  title: string;
  mentionCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphViewProps {
  data: KnowledgeGraphData;
  height?: number;
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
  onExpand?: (nodeId: string) => void;
}

/**
 * Dependency-free force-directed graph: repulsion + spring + centering
 * forces simulated for a fixed number of ticks, rendered as SVG.
 * Click selects a node; double-click expands it (loads its neighborhood).
 */
export function GraphView({ data, height = 560, selectedId, onSelect, onExpand }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hovered, setHovered] = useState<string | null>(null);

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
        mentionCount: n.mentionCount,
        x: width / 2 + radius * Math.cos(angle),
        y: height / 2 + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = data.edges.filter((e) => byId.has(e.from) && byId.has(e.to));

    const TICKS = 220;
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
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      for (const edge of edges) {
        const a = byId.get(edge.from)!;
        const b = byId.get(edge.to)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = SPRING * (dist - SPRING_LENGTH);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
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
    if (!hovered && !selectedId) return null;
    const focus = hovered ?? selectedId;
    const linked = new Set<string>([focus!]);
    for (const edge of layout.edges) {
      if (edge.from === focus) linked.add(edge.to);
      if (edge.to === focus) linked.add(edge.from);
    }
    return linked;
  }, [hovered, selectedId, layout.edges]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-lg border bg-card">
      <svg width={width} height={height} role="img" aria-label="Knowledge graph">
        {layout.edges.map((edge) => {
          const a = layout.byId.get(edge.from)!;
          const b = layout.byId.get(edge.to)!;
          const dimmed =
            neighborhood && !(neighborhood.has(edge.from) && neighborhood.has(edge.to));
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          return (
            <g key={edge.id} opacity={dimmed ? 0.12 : 0.75}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="currentColor"
                strokeWidth={1}
                className="text-muted-foreground"
              />
              <text
                x={midX}
                y={midY - 3}
                textAnchor="middle"
                fontSize={8}
                className="fill-muted-foreground select-none"
              >
                {edge.type}
              </text>
            </g>
          );
        })}
        {layout.nodes.map((node) => {
          const dimmed = neighborhood && !neighborhood.has(node.id);
          const r = Math.min(18, 7 + Math.sqrt(node.mentionCount) * 2.2);
          const selected = node.id === selectedId;
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              opacity={dimmed ? 0.25 : 1}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect?.(node.id)}
              onDoubleClick={() => onExpand?.(node.id)}
            >
              <circle
                r={r}
                fill={typeColor(node.type)}
                stroke={selected ? 'currentColor' : 'transparent'}
                strokeWidth={selected ? 3 : 0}
                className="text-foreground"
              />
              <text
                y={r + 11}
                textAnchor="middle"
                fontSize={10}
                className="fill-foreground select-none"
              >
                {node.title.length > 24 ? `${node.title.slice(0, 24)}…` : node.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
