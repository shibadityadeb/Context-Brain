import type { ConversationScope } from '@prisma/client';
import { ForbiddenError } from '../../utils/errors.js';

/**
 * Access Control Service — the single place that decides WHO may view, continue,
 * edit or delete a conversation. Deliberately decoupled from retrieval and
 * persistence: it takes an already-loaded conversation (scoped to the caller's
 * org) plus the caller, and answers yes/no. Retrieval never calls this, and this
 * never reads knowledge — authorization and data access stay separate concerns.
 *
 * v1 rules (org-membership is already enforced upstream by org-scoped loads):
 *   • PERSONAL → visible/editable only to its creator.
 *   • TEAM     → visible/continuable/editable by any member of the org.
 *   • Delete   → creator only, for both scopes.
 * The `ConversationParticipant` table is in place for future viewer/editor/admin
 * sharing; wiring finer roles here won't touch callers.
 */

export interface AccessSubject {
  userId: string;
}

export interface AccessConversation {
  scope: ConversationScope;
  createdBy: string;
}

export class AccessControlService {
  canView(user: AccessSubject, conversation: AccessConversation): boolean {
    if (conversation.scope === 'PERSONAL') return conversation.createdBy === user.userId;
    return true; // TEAM — any org member (org scoping already applied on load)
  }

  /** Continuing (posting a message) uses the same visibility rule in v1. */
  canContinue(user: AccessSubject, conversation: AccessConversation): boolean {
    return this.canView(user, conversation);
  }

  /** Rename / archive. */
  canEdit(user: AccessSubject, conversation: AccessConversation): boolean {
    if (conversation.scope === 'PERSONAL') return conversation.createdBy === user.userId;
    return true; // TEAM members may curate shared conversations
  }

  canDelete(user: AccessSubject, conversation: AccessConversation): boolean {
    return conversation.createdBy === user.userId;
  }

  // ── assertion helpers (throw ForbiddenError) ────────────────────────────────

  assertCanView(user: AccessSubject, conversation: AccessConversation): void {
    if (!this.canView(user, conversation))
      throw new ForbiddenError('You cannot view this conversation');
  }

  assertCanContinue(user: AccessSubject, conversation: AccessConversation): void {
    if (!this.canContinue(user, conversation))
      throw new ForbiddenError('You cannot post to this conversation');
  }

  assertCanEdit(user: AccessSubject, conversation: AccessConversation): void {
    if (!this.canEdit(user, conversation))
      throw new ForbiddenError('You cannot edit this conversation');
  }

  assertCanDelete(user: AccessSubject, conversation: AccessConversation): void {
    if (!this.canDelete(user, conversation))
      throw new ForbiddenError('Only the creator can delete this conversation');
  }
}
