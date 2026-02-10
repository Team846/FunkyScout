/**
 * Permissions Tests
 * Tests for role-based access control
 */

import { describe, it, expect } from 'vitest';
import {
  canViewPicklist,
  canEditPicklist,
  type UserRole,
  type PicklistType,
} from '../utils/permissions';

describe('Picklist Permissions', () => {
  describe('canViewPicklist', () => {
    describe('Admin Role', () => {
      it('should allow admin to view public picklists', () => {
        expect(canViewPicklist('admin', 'public')).toBe(true);
      });

      it('should allow admin to view private picklists', () => {
        expect(canViewPicklist('admin', 'private', 'other-uid', 'admin-uid')).toBe(true);
      });

      it('should allow admin to view default picklists', () => {
        expect(canViewPicklist('admin', 'default')).toBe(true);
      });
    });

    describe('Scouter Role', () => {
      it('should allow scouter to view public picklists', () => {
        expect(canViewPicklist('scouter', 'public')).toBe(true);
      });

      it('should allow scouter to view default picklists', () => {
        expect(canViewPicklist('scouter', 'default')).toBe(true);
      });

      it('should allow scouter to view own private picklists', () => {
        expect(canViewPicklist('scouter', 'private', 'uid123', 'uid123')).toBe(true);
      });

      it('should NOT allow scouter to view other users private picklists', () => {
        expect(canViewPicklist('scouter', 'private', 'other-uid', 'uid123')).toBe(false);
      });
    });

    describe('User Role', () => {
      it('should NOT allow user to view public picklists', () => {
        expect(canViewPicklist('user', 'public')).toBe(false);
      });

      it('should NOT allow user to view default picklists', () => {
        expect(canViewPicklist('user', 'default')).toBe(false);
      });

      it('should allow user to view own private picklists', () => {
        expect(canViewPicklist('user', 'private', 'uid123', 'uid123')).toBe(true);
      });

      it('should NOT allow user to view other users private picklists', () => {
        expect(canViewPicklist('user', 'private', 'other-uid', 'uid123')).toBe(false);
      });
    });
  });

  describe('canEditPicklist', () => {
    describe('Admin Role', () => {
      it('should allow admin to edit any public picklist', () => {
        expect(canEditPicklist('admin', 'public', 'other-uid', 'admin-uid')).toBe(true);
      });

      it('should allow admin to edit any private picklist', () => {
        expect(canEditPicklist('admin', 'private', 'other-uid', 'admin-uid')).toBe(true);
      });

      it('should allow admin to edit default picklist', () => {
        expect(canEditPicklist('admin', 'default')).toBe(true);
      });
    });

    describe('Scouter Role', () => {
      it('should allow scouter to edit own public picklist', () => {
        expect(canEditPicklist('scouter', 'public', 'uid123', 'uid123')).toBe(true);
      });

      it('should NOT allow scouter to edit other users public picklist', () => {
        expect(canEditPicklist('scouter', 'public', 'other-uid', 'uid123')).toBe(false);
      });

      it('should allow scouter to edit default picklist', () => {
        expect(canEditPicklist('scouter', 'default')).toBe(true);
      });

      it('should allow scouter to edit own private picklist', () => {
        expect(canEditPicklist('scouter', 'private', 'uid123', 'uid123')).toBe(true);
      });

      it('should NOT allow scouter to edit other users private picklist', () => {
        expect(canEditPicklist('scouter', 'private', 'other-uid', 'uid123')).toBe(false);
      });
    });

    describe('User Role', () => {
      it('should allow user to edit own private picklist', () => {
        expect(canEditPicklist('user', 'private', 'uid123', 'uid123')).toBe(true);
      });

      it('should NOT allow user to edit other users private picklist', () => {
        expect(canEditPicklist('user', 'private', 'other-uid', 'uid123')).toBe(false);
      });

      it('should NOT allow user to edit public picklists', () => {
        expect(canEditPicklist('user', 'public', 'uid123', 'uid123')).toBe(false);
      });

      it('should NOT allow user to edit default picklist', () => {
        expect(canEditPicklist('user', 'default')).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined UIDs gracefully', () => {
      expect(canViewPicklist('scouter', 'private', undefined, 'uid123')).toBe(false);
      expect(canViewPicklist('scouter', 'private', 'uid123', undefined)).toBe(false);
    });

    it('should handle mismatched UIDs for private picklists', () => {
      expect(canViewPicklist('admin', 'private', 'uid-a', 'uid-b')).toBe(true); // Admin override
      expect(canViewPicklist('scouter', 'private', 'uid-a', 'uid-b')).toBe(false);
    });

    it('should default to denying access for unknown picklist types', () => {
      expect(canViewPicklist('scouter', 'unknown' as PicklistType)).toBe(false);
      expect(canEditPicklist('scouter', 'unknown' as PicklistType)).toBe(false);
    });
  });
});

describe('Role Validation', () => {
  it('should recognize valid user roles', () => {
    const validRoles: UserRole[] = ['user', 'admin', 'scouter'];
    validRoles.forEach((role) => {
      expect(['user', 'admin', 'scouter']).toContain(role);
    });
  });

  it('should recognize valid picklist types', () => {
    const validTypes: PicklistType[] = ['public', 'private', 'default'];
    validTypes.forEach((type) => {
      expect(['public', 'private', 'default']).toContain(type);
    });
  });
});
