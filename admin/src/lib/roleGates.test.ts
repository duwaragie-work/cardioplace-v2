import {
  canManagePractices,
  canEditThisPractice,
  canCreateOrDeletePractices,
  canManageUsers,
  canPermanentCloseUsers,
  canAssignCareTeam,
  canDeactivateUser,
  invitableRoles,
  inviteRequiresPractice,
} from './roleGates';

// 2026-07-01 access-scope patch — MED_DIR practice-scoped admin authority +
// COORDINATOR walkbacks. Each assertion mirrors a backend @Roles / service
// scope decision (see docs/ACCESS_SCOPE.md §2.1).

describe('roleGates — 2026-07-01 access-scope patch', () => {
  describe('canManagePractices (config edit — +MED_DIR)', () => {
    it('allows MEDICAL_DIRECTOR', () => {
      expect(canManagePractices({ roles: ['MEDICAL_DIRECTOR'] })).toBe(true);
    });
    it('allows SUPER_ADMIN and HEALPLACE_OPS', () => {
      expect(canManagePractices({ roles: ['SUPER_ADMIN'] })).toBe(true);
      expect(canManagePractices({ roles: ['HEALPLACE_OPS'] })).toBe(true);
    });
    it('rejects PROVIDER and COORDINATOR', () => {
      expect(canManagePractices({ roles: ['PROVIDER'] })).toBe(false);
      expect(canManagePractices({ roles: ['COORDINATOR'] })).toBe(false);
    });
  });

  describe('canEditThisPractice (runtime per-practice scope)', () => {
    it('MED_DIR can edit a practice they head', () => {
      expect(
        canEditThisPractice(
          { id: 'md1', roles: ['MEDICAL_DIRECTOR'] },
          { id: 'p1', medicalDirectorIds: ['md1'] },
        ),
      ).toBe(true);
    });
    it('MED_DIR cannot edit a practice they do not head', () => {
      expect(
        canEditThisPractice(
          { id: 'md1', roles: ['MEDICAL_DIRECTOR'] },
          { id: 'p1', medicalDirectorIds: ['md2'] },
        ),
      ).toBe(false);
    });
    it('OPS / SUPER can edit any practice', () => {
      expect(
        canEditThisPractice({ id: 'o1', roles: ['HEALPLACE_OPS'] }, { id: 'p1', medicalDirectorIds: [] }),
      ).toBe(true);
      expect(
        canEditThisPractice({ id: 's1', roles: ['SUPER_ADMIN'] }, { id: 'p1' }),
      ).toBe(true);
    });
    it('returns false when practice is null (loading guard)', () => {
      expect(canEditThisPractice({ id: 'md1', roles: ['MEDICAL_DIRECTOR'] }, null)).toBe(false);
    });
    it('PROVIDER never edits practice config', () => {
      expect(
        canEditThisPractice({ id: 'pr1', roles: ['PROVIDER'] }, { id: 'p1', medicalDirectorIds: ['pr1'] }),
      ).toBe(false);
    });
  });

  describe('canCreateOrDeletePractices (org lifecycle — SUPER + OPS)', () => {
    it('allows SUPER_ADMIN and HEALPLACE_OPS', () => {
      expect(canCreateOrDeletePractices({ roles: ['SUPER_ADMIN'] })).toBe(true);
      expect(canCreateOrDeletePractices({ roles: ['HEALPLACE_OPS'] })).toBe(true);
    });
    it('rejects MEDICAL_DIRECTOR (they edit but do not create/delete)', () => {
      expect(canCreateOrDeletePractices({ roles: ['MEDICAL_DIRECTOR'] })).toBe(false);
    });
  });

  describe('canManageUsers (+MED_DIR)', () => {
    it('allows MEDICAL_DIRECTOR', () => {
      expect(canManageUsers({ roles: ['MEDICAL_DIRECTOR'] })).toBe(true);
    });
    it('allows COORDINATOR, OPS, SUPER', () => {
      expect(canManageUsers({ roles: ['COORDINATOR'] })).toBe(true);
      expect(canManageUsers({ roles: ['HEALPLACE_OPS'] })).toBe(true);
      expect(canManageUsers({ roles: ['SUPER_ADMIN'] })).toBe(true);
    });
    it('rejects PROVIDER', () => {
      expect(canManageUsers({ roles: ['PROVIDER'] })).toBe(false);
    });
  });

  describe('canPermanentCloseUsers (org-level — SUPER + OPS only)', () => {
    it('rejects COORDINATOR (walkback #114)', () => {
      expect(canPermanentCloseUsers({ roles: ['COORDINATOR'] })).toBe(false);
    });
    it('rejects MEDICAL_DIRECTOR (never had it)', () => {
      expect(canPermanentCloseUsers({ roles: ['MEDICAL_DIRECTOR'] })).toBe(false);
    });
    it('allows SUPER_ADMIN and HEALPLACE_OPS', () => {
      expect(canPermanentCloseUsers({ roles: ['SUPER_ADMIN'] })).toBe(true);
      expect(canPermanentCloseUsers({ roles: ['HEALPLACE_OPS'] })).toBe(true);
    });
  });

  describe('canAssignCareTeam (walkback — COORDINATOR excluded)', () => {
    it('rejects COORDINATOR (walkback #116)', () => {
      expect(canAssignCareTeam({ roles: ['COORDINATOR'] })).toBe(false);
    });
    it('allows SUPER, MED_DIR, OPS', () => {
      expect(canAssignCareTeam({ roles: ['SUPER_ADMIN'] })).toBe(true);
      expect(canAssignCareTeam({ roles: ['MEDICAL_DIRECTOR'] })).toBe(true);
      expect(canAssignCareTeam({ roles: ['HEALPLACE_OPS'] })).toBe(true);
    });
    it('rejects PROVIDER', () => {
      expect(canAssignCareTeam({ roles: ['PROVIDER'] })).toBe(false);
    });
  });

  describe('canDeactivateUser (+MED_DIR practice-scoped branch)', () => {
    it('MED_DIR can deactivate a non-org target', () => {
      expect(canDeactivateUser({ roles: ['MEDICAL_DIRECTOR'] }, ['PROVIDER'])).toBe(true);
      expect(canDeactivateUser({ roles: ['MEDICAL_DIRECTOR'] }, ['PATIENT'])).toBe(true);
    });
    it('MED_DIR cannot deactivate SUPER_ADMIN or HEALPLACE_OPS', () => {
      expect(canDeactivateUser({ roles: ['MEDICAL_DIRECTOR'] }, ['SUPER_ADMIN'])).toBe(false);
      expect(canDeactivateUser({ roles: ['MEDICAL_DIRECTOR'] }, ['HEALPLACE_OPS'])).toBe(false);
    });
    it('COORDINATOR still limited to patient-only targets', () => {
      expect(canDeactivateUser({ roles: ['COORDINATOR'] }, ['PATIENT'])).toBe(true);
      expect(canDeactivateUser({ roles: ['COORDINATOR'] }, ['PROVIDER'])).toBe(false);
    });
  });

  describe('invitableRoles / inviteRequiresPractice (MED_DIR)', () => {
    it('MED_DIR can invite clinicians + patients + coordinators, not org roles', () => {
      const roles = invitableRoles({ roles: ['MEDICAL_DIRECTOR'] });
      expect(roles).toEqual(
        expect.arrayContaining(['PATIENT', 'PROVIDER', 'MEDICAL_DIRECTOR', 'COORDINATOR']),
      );
      expect(roles).not.toContain('HEALPLACE_OPS');
      expect(roles).not.toContain('SUPER_ADMIN');
    });
    it('MED_DIR invites require a practice pick', () => {
      expect(inviteRequiresPractice({ roles: ['MEDICAL_DIRECTOR'] }, 'PROVIDER')).toBe(true);
    });
  });
});
