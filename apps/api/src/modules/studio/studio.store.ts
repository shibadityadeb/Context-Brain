import type { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../utils/errors.js';
import { PRESENTATION_DETAIL_INCLUDE, type PresentationWithDetail } from './studio.types.js';

/**
 * Shared persistence helpers for Studio. Every service loads a deck the same way
 * (org-scoped, with ordered slides + assets) and renumbers slides the same way,
 * so those primitives live here rather than being duplicated. Mirrors
 * `actions/action.store.ts`.
 */

/** Load a presentation scoped to the org (with slides + assets), or 404. */
export async function requirePresentation(
  prisma: PrismaClient,
  organizationId: string,
  id: string,
): Promise<PresentationWithDetail> {
  const presentation = await prisma.studioPresentation.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: PRESENTATION_DETAIL_INCLUDE,
  });
  if (!presentation) throw new NotFoundError('Presentation not found');
  return presentation;
}

/** Compact slide indexes to 0..n-1 in their current order (after delete/reorder). */
export async function reindexSlides(prisma: PrismaClient, presentationId: string): Promise<void> {
  const slides = await prisma.studioSlide.findMany({
    where: { presentationId },
    orderBy: { index: 'asc' },
    select: { id: true },
  });
  await prisma.$transaction(
    slides.map((s, i) => prisma.studioSlide.update({ where: { id: s.id }, data: { index: i } })),
  );
}

/** Bump updatedAt (touch) so lists re-sort and the "outdated?" checks have a marker. */
export async function touchPresentation(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.studioPresentation.update({ where: { id }, data: { updatedAt: new Date() } });
}
