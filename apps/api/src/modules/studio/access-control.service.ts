import type { StudioPresentation } from '@prisma/client';
import { ForbiddenError } from '../../utils/errors.js';

/**
 * Phase-1 access model for Studio: a presentation is EDITABLE by its creator and
 * VISIBLE to everyone in the org (so teammates can view/present/export). This is
 * the same simple rule Ask Brain uses for Team conversations. Per-user sharing
 * (a ResourcePermission-style table) lands in Phase 2 without touching callers.
 */
export class StudioAccessControl {
  /** Org membership is enforced upstream (org-scoped query); everyone in the org may view. */
  canView(_userId: string, _presentation: Pick<StudioPresentation, 'createdBy'>): boolean {
    return true;
  }

  canEdit(userId: string, presentation: Pick<StudioPresentation, 'createdBy'>): boolean {
    return presentation.createdBy === userId;
  }

  assertCanEdit(userId: string, presentation: Pick<StudioPresentation, 'createdBy'>): void {
    if (!this.canEdit(userId, presentation)) {
      throw new ForbiddenError('Only the creator can edit this presentation');
    }
  }
}
