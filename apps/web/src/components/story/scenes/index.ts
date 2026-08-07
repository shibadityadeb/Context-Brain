import type { ComponentType } from 'react';
import type { ArtDirection, SceneKind } from '@company-brain/studio';
import type { SceneProps } from '../atoms';
import {
  ChapterScene,
  CTAScene,
  HeroScene,
  ProblemScene,
  QuoteScene,
  RevealScene,
  StatementScene,
  VisionScene,
} from './narrative';
import { MetricsScene, ShowcaseScene, TimelineScene } from './data';
import { ArchitectureScene, GraphScene } from './diagrams';
import { DemoScene } from './demo';

export type SceneComponent = ComponentType<SceneProps & { art: ArtDirection }>;

/**
 * The scene registry. Adding a narrative capability means adding one component
 * and one entry here — the same "registry, never a migration" convention the
 * layout and theme catalogues already follow.
 */
export const SCENE_COMPONENTS: Record<SceneKind, SceneComponent> = {
  hero: HeroScene,
  chapter: ChapterScene,
  statement: StatementScene,
  problem: ProblemScene,
  reveal: RevealScene,
  metrics: MetricsScene,
  architecture: ArchitectureScene,
  graph: GraphScene,
  timeline: TimelineScene,
  showcase: ShowcaseScene,
  quote: QuoteScene,
  demo: DemoScene,
  vision: VisionScene,
  cta: CTAScene,
};
