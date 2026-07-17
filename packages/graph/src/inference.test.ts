import { describe, expect, it } from 'vitest';
import { inferEdges } from './inference.js';
import { resolveGraphConfig } from './config.js';
import type { GraphEdge } from './types.js';

const config = resolveGraphConfig();

let seq = 0;
const e = (from: string, to: string, type: string, confidence = 0.9): GraphEdge => ({
  id: `e${seq++}`,
  from,
  to,
  type,
  confidence,
});

describe('inferEdges', () => {
  it('derives Meeting RELATED_TO Project from REFERENCES ∘ BELONGS_TO', () => {
    // Meeting --REFERENCES--> BugA --BELONGS_TO--> ProjectX
    const edges = [e('meeting', 'bugA', 'REFERENCES'), e('bugA', 'projectX', 'BELONGS_TO')];
    const inferred = inferEdges(edges, config);
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toMatchObject({
      from: 'meeting',
      to: 'projectX',
      type: 'RELATED_TO',
      via: 'bugA',
    });
    expect(inferred[0]!.confidence).toBeCloseTo(0.9 * 0.9 * 0.8);
  });

  it('derives Person WORKS_ON Project from ASSIGNED_TO ∘ PART_OF', () => {
    const edges = [e('ada', 'task1', 'ASSIGNED_TO'), e('task1', 'atlas', 'PART_OF')];
    const inferred = inferEdges(edges, config);
    expect(inferred[0]).toMatchObject({ from: 'ada', to: 'atlas', type: 'WORKS_ON' });
  });

  it('does not re-infer an edge that already exists directly', () => {
    const edges = [
      e('meeting', 'bugA', 'REFERENCES'),
      e('bugA', 'projectX', 'BELONGS_TO'),
      e('meeting', 'projectX', 'RELATED_TO'), // already known
    ];
    expect(inferEdges(edges, config)).toHaveLength(0);
  });

  it('drops derivations below the confidence floor', () => {
    const edges = [e('m', 'b', 'REFERENCES', 0.5), e('b', 'p', 'BELONGS_TO', 0.5)];
    // 0.5 * 0.5 * 0.8 = 0.2 < minInferredConfidence (0.3)
    expect(inferEdges(edges, config)).toHaveLength(0);
  });

  it('keeps the highest-confidence derivation when several pivots exist', () => {
    const edges = [
      e('m', 'b1', 'REFERENCES', 0.6),
      e('b1', 'p', 'BELONGS_TO', 0.9),
      e('m', 'b2', 'REFERENCES', 0.95),
      e('b2', 'p', 'BELONGS_TO', 0.95),
    ];
    const inferred = inferEdges(edges, config);
    expect(inferred).toHaveLength(1);
    expect(inferred[0]!.via).toBe('b2');
  });

  it('never produces a self-loop', () => {
    const edges = [e('x', 'y', 'PART_OF'), e('y', 'x', 'PART_OF')];
    expect(inferEdges(edges, config).every((i) => i.from !== i.to)).toBe(true);
  });
});
