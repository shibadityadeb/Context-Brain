import { describe, expect, it } from 'vitest';
import { AccessControlService } from '../src/modules/ask/access-control.service.js';

const svc = new AccessControlService();
const owner = { userId: 'user-1' };
const other = { userId: 'user-2' };

describe('AccessControlService — personal conversations', () => {
  const personal = { scope: 'PERSONAL' as const, createdBy: 'user-1' };

  it('is visible/editable only to the creator', () => {
    expect(svc.canView(owner, personal)).toBe(true);
    expect(svc.canView(other, personal)).toBe(false);
    expect(svc.canEdit(other, personal)).toBe(false);
    expect(svc.canContinue(other, personal)).toBe(false);
  });

  it('throws when another user tries to view', () => {
    expect(() => svc.assertCanView(other, personal)).toThrow();
    expect(() => svc.assertCanView(owner, personal)).not.toThrow();
  });
});

describe('AccessControlService — team conversations', () => {
  const team = { scope: 'TEAM' as const, createdBy: 'user-1' };

  it('is visible/continuable/editable by any org member', () => {
    expect(svc.canView(other, team)).toBe(true);
    expect(svc.canContinue(other, team)).toBe(true);
    expect(svc.canEdit(other, team)).toBe(true);
  });

  it('can only be deleted by its creator', () => {
    expect(svc.canDelete(owner, team)).toBe(true);
    expect(svc.canDelete(other, team)).toBe(false);
    expect(() => svc.assertCanDelete(other, team)).toThrow();
  });
});
