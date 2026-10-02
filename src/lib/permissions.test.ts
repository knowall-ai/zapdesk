import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  hasAnyPermission,
  mergePermissions,
  isPermission,
  isUserRole,
  parsePermissionList,
  parseRoleDefinitions,
  validatePermissionsConfig,
  hasReachableAdmin,
  isBootstrapAdmin,
  bootstrapAdminEmails,
} from './permissions';
import type {
  Permission,
  PermissionsConfig,
  SessionPermissions,
  UserPermissionOverride,
} from '@/types';

const session = (permissions: Permission[]): SessionPermissions => ({
  role: 'agent',
  permissions,
});

describe('hasPermission', () => {
  it('grants what is listed and nothing else', () => {
    const s = session(['tickets:view_all', 'tickets:edit']);
    expect(hasPermission(s, 'tickets:edit')).toBe(true);
    expect(hasPermission(s, 'tickets:delete')).toBe(false);
  });

  it('denies everything for an empty permission set', () => {
    expect(hasPermission(session([]), 'tickets:view_own')).toBe(false);
  });
});

describe('hasAnyPermission', () => {
  it('passes when one of the alternatives is held', () => {
    const s = session(['tickets:view_own']);
    expect(hasAnyPermission(s, ['tickets:view_all', 'tickets:view_own'])).toBe(true);
  });

  it('fails when none are held', () => {
    expect(hasAnyPermission(session(['team:view']), ['tickets:view_all', 'tickets:view_own'])).toBe(
      false
    );
  });

  it('fails on an empty alternatives list rather than passing by default', () => {
    expect(hasAnyPermission(session(['tickets:edit']), [])).toBe(false);
  });
});

describe('mergePermissions', () => {
  const base: Permission[] = ['tickets:view_all', 'tickets:edit'];

  it('returns the role permissions when there is no override', () => {
    expect(mergePermissions(base)).toEqual(base);
    expect(mergePermissions(base, {})).toEqual(base);
  });

  it('adds a granted permission', () => {
    expect(mergePermissions(base, { permissions: ['tickets:delete'] })).toContain('tickets:delete');
  });

  it('does not duplicate a permission the role already has', () => {
    const out = mergePermissions(base, { permissions: ['tickets:edit'] });
    expect(out.filter((p) => p === 'tickets:edit')).toHaveLength(1);
  });

  it('removes a revoked permission', () => {
    expect(mergePermissions(base, { revokedPermissions: ['tickets:edit'] })).not.toContain(
      'tickets:edit'
    );
  });

  it('lets revocation win over a grant of the same permission', () => {
    // A contradictory config must fail closed, not open.
    const out = mergePermissions(base, {
      permissions: ['tickets:delete'],
      revokedPermissions: ['tickets:delete'],
    });
    expect(out).not.toContain('tickets:delete');
  });

  it('does not mutate the role definition it was given', () => {
    const roleDefinition: Permission[] = ['tickets:view_all'];
    mergePermissions(roleDefinition, { permissions: ['tickets:delete'] });
    expect(roleDefinition).toEqual(['tickets:view_all']);
  });

  it('tolerates an empty revocation list', () => {
    expect(mergePermissions(base, { revokedPermissions: [] })).toEqual(base);
  });
});

describe('isPermission / isUserRole', () => {
  it('accepts the known values', () => {
    expect(isPermission('tickets:delete')).toBe(true);
    expect(isUserRole('admin')).toBe(true);
  });

  it('rejects anything else, including near misses', () => {
    expect(isPermission('tickets:destroy')).toBe(false);
    expect(isPermission('')).toBe(false);
    expect(isPermission(null)).toBe(false);
    expect(isUserRole('superadmin')).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
  });
});

describe('parsePermissionList', () => {
  it('accepts a list of known permissions and drops duplicates', () => {
    expect(parsePermissionList(['tickets:edit', 'tickets:edit'])).toEqual(['tickets:edit']);
  });

  it('accepts an empty list', () => {
    expect(parsePermissionList([])).toEqual([]);
  });

  it('rejects the whole list when one entry is unknown', () => {
    // Filtering instead would silently discard an admin's typo and leave them
    // looking at a permission they believe they granted.
    expect(parsePermissionList(['tickets:edit', 'tickets:teleport'])).toBeNull();
  });

  it('rejects a non-array', () => {
    expect(parsePermissionList('tickets:edit')).toBeNull();
    expect(parsePermissionList(undefined)).toBeNull();
  });
});

describe('parseRoleDefinitions', () => {
  const role = (over: Record<string, unknown> = {}) => ({
    name: 'agent',
    label: 'Agent',
    description: 'desc',
    permissions: ['tickets:view_all'],
    ...over,
  });

  it('accepts a well-formed definition', () => {
    expect(parseRoleDefinitions([role()])).toEqual([
      { name: 'agent', label: 'Agent', description: 'desc', permissions: ['tickets:view_all'] },
    ]);
  });

  it('defaults a missing description rather than rejecting', () => {
    const parsed = parseRoleDefinitions([role({ description: undefined })]);
    expect(parsed?.[0].description).toBe('');
  });

  it('rejects an unknown role name', () => {
    expect(parseRoleDefinitions([role({ name: 'owner' })])).toBeNull();
  });

  it('rejects a duplicate role name', () => {
    expect(parseRoleDefinitions([role(), role()])).toBeNull();
  });

  it('rejects a blank label', () => {
    expect(parseRoleDefinitions([role({ label: '   ' })])).toBeNull();
  });

  it('rejects an unknown permission inside a role', () => {
    expect(parseRoleDefinitions([role({ permissions: ['tickets:everything'] })])).toBeNull();
  });

  it('rejects an empty or non-array roles value', () => {
    expect(parseRoleDefinitions([])).toBeNull();
    expect(parseRoleDefinitions({})).toBeNull();
    expect(parseRoleDefinitions([null])).toBeNull();
  });
});

describe('validatePermissionsConfig', () => {
  const config = (over: Record<string, unknown> = {}) => ({
    defaultRole: 'agent',
    roles: [{ name: 'agent', label: 'Agent', description: '', permissions: ['tickets:view_all'] }],
    users: [],
    ...over,
  });

  it('accepts a valid config', () => {
    expect(validatePermissionsConfig(config())).not.toBeNull();
  });

  it('treats a missing users list as empty', () => {
    expect(validatePermissionsConfig(config({ users: undefined }))?.users).toEqual([]);
  });

  it('rejects a defaultRole with no matching definition', () => {
    // It would resolve to an empty permission set and lock out every user who
    // has no explicit override, with nothing on screen to explain why.
    expect(validatePermissionsConfig(config({ defaultRole: 'admin' }))).toBeNull();
  });

  it('rejects an unknown defaultRole', () => {
    expect(validatePermissionsConfig(config({ defaultRole: 'root' }))).toBeNull();
  });

  it('rejects a user override with an unknown role', () => {
    expect(
      validatePermissionsConfig(config({ users: [{ email: 'a@b.c', role: 'root' }] }))
    ).toBeNull();
  });

  it('rejects a user override with an unknown permission', () => {
    expect(
      validatePermissionsConfig(
        config({ users: [{ email: 'a@b.c', role: 'agent', permissions: ['tickets:nope'] }] })
      )
    ).toBeNull();
  });

  it('rejects a user override with no email', () => {
    expect(
      validatePermissionsConfig(config({ users: [{ email: '  ', role: 'agent' }] }))
    ).toBeNull();
  });

  it('rejects values that are not a config at all', () => {
    expect(validatePermissionsConfig(null)).toBeNull();
    expect(validatePermissionsConfig('{}')).toBeNull();
    expect(validatePermissionsConfig([])).toBeNull();
    expect(validatePermissionsConfig({})).toBeNull();
  });
});

describe('hasReachableAdmin', () => {
  const config = (over: Partial<PermissionsConfig> = {}): PermissionsConfig => ({
    defaultRole: 'agent',
    roles: [
      { name: 'admin', label: 'Admin', description: '', permissions: ['admin:manage_roles'] },
      { name: 'agent', label: 'Agent', description: '', permissions: ['tickets:view_all'] },
    ],
    users: [],
    ...over,
  });

  const user = (over: Partial<UserPermissionOverride> = {}): UserPermissionOverride => ({
    userId: 'a@b.c',
    email: 'a@b.c',
    role: 'agent',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test',
    ...over,
  });

  it('is true when the default role can manage roles', () => {
    expect(hasReachableAdmin(config({ defaultRole: 'admin' }))).toBe(true);
  });

  it('is true when a user override resolves to a managing role', () => {
    expect(hasReachableAdmin(config({ users: [user({ role: 'admin' })] }))).toBe(true);
  });

  it('is true when an override grants the permission outright', () => {
    expect(
      hasReachableAdmin(config({ users: [user({ permissions: ['admin:manage_roles'] })] }))
    ).toBe(true);
  });

  it('is false when nobody resolves to it, even though a role defines it', () => {
    // The distinction that matters: an admin role nobody holds is no use.
    expect(hasReachableAdmin(config())).toBe(false);
  });

  it('is false when the only administrator has the permission revoked', () => {
    expect(
      hasReachableAdmin(
        config({ users: [user({ role: 'admin', revokedPermissions: ['admin:manage_roles'] })] })
      )
    ).toBe(false);
  });

  it('is false once no role defines it at all', () => {
    // The edit that cannot be undone from the admin screen: recovering means
    // hand-editing JSON on the server, or a bootstrap admin.
    expect(
      hasReachableAdmin(
        config({
          defaultRole: 'admin',
          roles: [
            { name: 'admin', label: 'Admin', description: '', permissions: ['admin:access'] },
          ],
        })
      )
    ).toBe(false);
  });
});

describe('bootstrap administrators', () => {
  it('parses a comma-separated list, trimming and lowercasing', () => {
    expect(bootstrapAdminEmails(' A@B.c , d@e.f ')).toEqual(['a@b.c', 'd@e.f']);
  });

  it('ignores empty entries and an unset variable', () => {
    expect(bootstrapAdminEmails('a@b.c,,')).toEqual(['a@b.c']);
    expect(bootstrapAdminEmails(undefined)).toEqual([]);
    expect(bootstrapAdminEmails('')).toEqual([]);
  });

  it('matches regardless of case or surrounding space', () => {
    expect(isBootstrapAdmin('A@B.c', 'a@b.c')).toBe(true);
    expect(isBootstrapAdmin(' a@b.c ', 'a@b.c')).toBe(true);
  });

  it('does not match anyone else', () => {
    expect(isBootstrapAdmin('x@y.z', 'a@b.c')).toBe(false);
  });

  it('never matches an empty email, however the list is written', () => {
    // An unauthenticated or malformed session must not fall into the admin
    // escape hatch by matching a blank entry.
    expect(isBootstrapAdmin('', 'a@b.c')).toBe(false);
    expect(isBootstrapAdmin('   ', ',,')).toBe(false);
    expect(isBootstrapAdmin('', '')).toBe(false);
  });
});
