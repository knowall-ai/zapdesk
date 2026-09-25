import { describe, it, expect } from 'vitest';
import { decidePermissionGate } from './permission-gate';
import type { Permission } from '@/types';

const held = (permissions: Permission[]) => ({
  has: (p: Permission) => permissions.includes(p),
  hasAny: (ps: Permission[]) => ps.some((p) => permissions.includes(p)),
});

const decide = (modes: Parameters<typeof decidePermissionGate>[0], permissions: Permission[]) => {
  const { has, hasAny } = held(permissions);
  return decidePermissionGate(modes, has, hasAny);
};

describe('decidePermissionGate', () => {
  describe('single permission', () => {
    it('allows when the permission is held', () => {
      expect(decide({ permission: 'tickets:edit' }, ['tickets:edit'])).toBe('allow');
    });

    it('denies when it is not', () => {
      expect(decide({ permission: 'tickets:delete' }, ['tickets:edit'])).toBe('deny');
    });
  });

  describe('any of several permissions', () => {
    it('allows when one of them is held', () => {
      expect(
        decide({ anyPermission: ['tickets:view_all', 'tickets:view_own'] }, ['tickets:view_own'])
      ).toBe('allow');
    });

    it('denies when none are', () => {
      expect(
        decide({ anyPermission: ['tickets:view_all', 'tickets:view_own'] }, ['team:view'])
      ).toBe('deny');
    });

    it('denies an empty list rather than treating it as no requirement', () => {
      // "any of nothing" is satisfied by nothing. Reading it the other way
      // would turn a gate with an accidentally-empty array into an open door.
      expect(decide({ anyPermission: [] }, ['admin:access'])).toBe('deny');
    });
  });

  describe('misconfiguration', () => {
    it('reports a gate with no permission at all', () => {
      // The important case: this used to render children to everyone.
      expect(decide({}, [])).toBe('misconfigured');
      expect(decide({}, ['admin:access'])).toBe('misconfigured');
    });

    it('reports a gate given both modes at once', () => {
      // Previously ANDed silently. A reader could just as reasonably expect
      // OR, so the ambiguity is refused instead of guessed at.
      expect(
        decide({ permission: 'admin:access', anyPermission: ['tickets:view_own'] }, [
          'admin:access',
          'tickets:view_own',
        ])
      ).toBe('misconfigured');
    });

    it('reports a non-array anyPermission instead of throwing', () => {
      // Reachable from a JS caller or an `as any` cast. Reading `.length` off
      // null would take the whole surrounding page down mid-render.
      const bad = { anyPermission: null } as unknown as Parameters<typeof decidePermissionGate>[0];
      expect(() => decide(bad, ['admin:access'])).not.toThrow();
      expect(decide(bad, ['admin:access'])).toBe('misconfigured');
      expect(
        decide(
          { anyPermission: 'admin:access' } as unknown as Parameters<
            typeof decidePermissionGate
          >[0],
          ['admin:access']
        )
      ).toBe('misconfigured');
    });

    it('does not open even when the user holds everything', () => {
      const all: Permission[] = ['admin:access', 'admin:manage_roles', 'tickets:view_all'];
      expect(decide({}, all)).toBe('misconfigured');
    });
  });
});
