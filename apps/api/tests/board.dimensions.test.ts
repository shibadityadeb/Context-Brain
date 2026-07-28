import { describe, expect, it } from 'vitest';
import { bucketCardDimensions, type DimensionEdge } from '../src/modules/board/board.service.js';

const edge = (
  type: string,
  fromId: string,
  fromType: string,
  toId: string,
  toType: string,
): DimensionEdge => ({
  type,
  fromId,
  toId,
  from: { id: fromId, type: fromType, title: fromType.toLowerCase() + ':' + fromId },
  to: { id: toId, type: toType, title: toType.toLowerCase() + ':' + toId },
});

describe('bucketCardDimensions', () => {
  it('buckets neighbors by type and edge direction', () => {
    const edges = [
      edge('PART_OF', 'card1', 'TASK', 'projA', 'PROJECT'),
      edge('DISCUSSED_IN', 'card1', 'TASK', 'meet1', 'MEETING'),
      edge('RELATES_TO', 'card1', 'TASK', 'topX', 'TOPIC'),
      edge('ASSIGNED_TO', 'card1', 'TASK', 'perA', 'PERSON'),
    ];
    const dims = bucketCardDimensions(['card1'], edges).get('card1')!;
    expect(dims.projects).toEqual([{ id: 'projA', title: 'project:projA' }]);
    expect(dims.meeting).toEqual({ id: 'meet1', title: 'meeting:meet1' });
    expect(dims.topics).toEqual([{ id: 'topX', title: 'topic:topX' }]);
    expect(dims.people).toEqual([{ id: 'perA', title: 'person:perA' }]);
  });

  it('counts involvement edges (owner + reporter) as people, ignores weak ones', () => {
    const edges = [
      edge('REPORTED', 'card1', 'TASK', 'perR', 'PERSON'),
      edge('ASSIGNED_TO', 'card1', 'TASK', 'perO', 'PERSON'),
      edge('MENTIONS', 'card1', 'TASK', 'perM', 'PERSON'),
    ];
    const people = bucketCardDimensions(['card1'], edges).get('card1')!.people;
    expect(people.map((p) => p.id).sort()).toEqual(['perO', 'perR']);
  });

  it('dedupes repeated projects and keeps only the first meeting', () => {
    const edges = [
      edge('PART_OF', 'card1', 'TASK', 'projA', 'PROJECT'),
      edge('RELATES_TO', 'card1', 'TASK', 'projA', 'PROJECT'),
      edge('GENERATED_FROM', 'card1', 'TASK', 'meet1', 'MEETING'),
      edge('DISCUSSED_IN', 'card1', 'TASK', 'meet2', 'MEETING'),
    ];
    const dims = bucketCardDimensions(['card1'], edges).get('card1')!;
    expect(dims.projects).toHaveLength(1);
    expect(dims.meeting?.id).toBe('meet1');
  });

  it('resolves when the card is the edge target (reverse direction)', () => {
    const edges = [edge('PART_OF', 'projA', 'PROJECT', 'card1', 'TASK')];
    expect(bucketCardDimensions(['card1'], edges).get('card1')!.projects).toEqual([
      { id: 'projA', title: 'project:projA' },
    ]);
  });

  it('returns empty dimensions for a card with no edges', () => {
    const dims = bucketCardDimensions(['card1'], []).get('card1')!;
    expect(dims).toEqual({ projects: [], people: [], topics: [], meeting: null });
  });
});
