import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PERMISSIONS, USER_ROLES } from '@/types';
import type {
  PermissionsConfig,
  UserPermissionOverride,
  Permission,
  UserRole,
  RoleDefinition,
  PermissionAuditEntry,
  SessionPermissions,
} from '@/types';

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_PATH = join(DATA_DIR, 'permissions.json');
const AUDIT_LOG_PATH = join(DATA_DIR, 'permissions-audit.log');

// Default role definitions
const DEFAULT_ROLES: RoleDefinition[] = [
  {
    name: 'admin',
    label: 'Admin',
    description: 'Full access to all features including role management',
    permissions: [
      'admin:access',
      'admin:manage_roles',
      'tickets:view_all',
      'tickets:view_own',
      'tickets:create',
      'tickets:edit',
      'tickets:assign',
      'tickets:change_status',
      'tickets:create_internal_notes',
      'tickets:delete',
      'team:view',
      'users:view',
      'projects:view',
      'reporting:view',
      'reporting:monthly_checkpoint',
    ],
  },
  {
    name: 'agent',
    label: 'Agent',
    description: 'Access to all tickets, team, reporting, and internal notes',
    permissions: [
      'tickets:view_all',
      'tickets:view_own',
      'tickets:create',
      'tickets:edit',
      'tickets:assign',
      'tickets:change_status',
      'tickets:create_internal_notes',
      'team:view',
      'users:view',
      'projects:view',
      'reporting:view',
      'reporting:monthly_checkpoint',
    ],
  },
  {
    name: 'client',
    label: 'Client',
    description: 'View and create own tickets only',
    permissions: ['tickets:view_own', 'tickets:create'],
  },
];

const DEFAULT_CONFIG: PermissionsConfig = {
  defaultRole: 'agent',
  roles: DEFAULT_ROLES,
  users: [],
};

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ===== Validation =====

/**
 * Thrown when `permissions.json` exists but cannot be trusted.
 *
 * Callers must not paper over this with defaults: the file is the
 * authoritative record of who may do what, and a half-written or hand-edited
 * file that silently resolves to `DEFAULT_CONFIG` would hand every
 * authenticated user the default `agent` role -- broad ticket access -- at
 * exactly the moment the system has lost track of who they are.
 */
export class PermissionsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionsConfigError';
  }
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Validate a permission array. Returns `null` -- not a filtered array -- when
 * anything is unrecognised, so a typo is reported rather than quietly dropped.
 */
export function parsePermissionList(value: unknown): Permission[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(isPermission)) return null;
  return [...new Set(value as Permission[])];
}

export function parseRoleDefinitions(value: unknown): RoleDefinition[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const roles: RoleDefinition[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const r = entry as Record<string, unknown>;

    if (!isUserRole(r.name) || seen.has(r.name)) return null;
    if (typeof r.label !== 'string' || !r.label.trim()) return null;
    if (r.description !== undefined && typeof r.description !== 'string') return null;

    const permissions = parsePermissionList(r.permissions);
    if (!permissions) return null;

    seen.add(r.name);
    roles.push({
      name: r.name,
      label: r.label,
      description: typeof r.description === 'string' ? r.description : '',
      permissions,
    });
  }

  return roles;
}

/**
 * Validate a whole config. Anything the app cannot act on is rejected --
 * including a `defaultRole` with no matching definition, which would resolve
 * to an empty permission set and lock users out with no explanation.
 */
export function validatePermissionsConfig(value: unknown): PermissionsConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;

  const roles = parseRoleDefinitions(c.roles);
  if (!roles) return null;

  if (!isUserRole(c.defaultRole)) return null;
  if (!roles.some((r) => r.name === c.defaultRole)) return null;

  if (c.users !== undefined && !Array.isArray(c.users)) return null;
  const users = (c.users ?? []) as UserPermissionOverride[];
  for (const u of users) {
    if (typeof u !== 'object' || u === null) return null;
    if (typeof u.email !== 'string' || !u.email.trim()) return null;
    if (!isUserRole(u.role)) return null;
    if (u.permissions !== undefined && !parsePermissionList(u.permissions)) return null;
    if (u.revokedPermissions !== undefined && !parsePermissionList(u.revokedPermissions)) {
      return null;
    }
  }

  return { defaultRole: c.defaultRole, roles, users };
}

/**
 * Emails allowed to administer regardless of what the config file says.
 *
 * This is the answer to the bootstrap problem: on a machine with no
 * `permissions.json`, the seeded config has `defaultRole: 'agent'` and no user
 * overrides, so nobody can reach the admin endpoints to appoint the first
 * administrator. It doubles as the way back in after a config edit that
 * removes the last one.
 *
 * Kept in the environment rather than the file deliberately: it must not be
 * editable through the screen it exists to recover.
 */
export function bootstrapAdminEmails(raw = process.env.ZAPDESK_ADMIN_EMAILS): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isBootstrapAdmin(email: string, raw = process.env.ZAPDESK_ADMIN_EMAILS): boolean {
  if (!email.trim()) return false;
  return bootstrapAdminEmails(raw).includes(email.trim().toLowerCase());
}

/**
 * Can anyone still reach `admin:manage_roles` under this config?
 *
 * Not the same question as whether some role definition lists the permission:
 * a role nobody holds is no use. An administrator is reachable when the
 * default role can manage roles, or some user override resolves to a role
 * that can, or an override grants the permission outright -- in each case
 * only if that same override does not revoke it again.
 *
 * The write endpoint refuses a config that fails this, because it is the one
 * edit that cannot be undone from the screen that made it. A bootstrap admin
 * is a separate, deliberately out-of-band way back in.
 */
export function hasReachableAdmin(config: PermissionsConfig): boolean {
  const managing = new Set(
    config.roles.filter((r) => r.permissions.includes('admin:manage_roles')).map((r) => r.name)
  );

  const keepsIt = (u: UserPermissionOverride) =>
    !(u.revokedPermissions ?? []).includes('admin:manage_roles');

  if (managing.has(config.defaultRole)) {
    // Someone with no override at all inherits it, unless every user is
    // overridden -- which is not knowable here, and defaultRole users are the
    // normal case.
    return true;
  }

  return config.users.some(
    (u) =>
      keepsIt(u) && (managing.has(u.role) || (u.permissions ?? []).includes('admin:manage_roles'))
  );
}

export function readPermissionsConfig(): PermissionsConfig {
  ensureDataDir();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (error) {
    throw new PermissionsConfigError(
      `${CONFIG_PATH} could not be read or parsed: ${(error as Error).message}`
    );
  }

  const config = validatePermissionsConfig(parsed);
  if (!config) {
    throw new PermissionsConfigError(`${CONFIG_PATH} is not a valid permissions config`);
  }

  return config;
}

export function writePermissionsConfig(config: PermissionsConfig): void {
  ensureDataDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Resolve a user's effective role and permissions.
 * Checks for user-specific overrides, otherwise falls back to defaultRole.
 */
export function resolveUserPermissions(email: string, userId?: string): SessionPermissions {
  let config: PermissionsConfig;
  try {
    config = readPermissionsConfig();
  } catch (error) {
    // Not gated behind a debug flag: this is a fault an operator has to see.
    console.error(
      'Permissions config is unusable - denying all permissions until it is repaired.',
      error
    );
    if (isBootstrapAdmin(email)) {
      const builtInAdmin = DEFAULT_ROLES.find((r) => r.name === 'admin');
      return { role: 'admin', permissions: [...(builtInAdmin?.permissions ?? [])] };
    }
    return { role: 'client', permissions: [] };
  }

  // Checked before the override lookup so it cannot be revoked by the config
  // it exists to repair. Uses the built-in admin permission set rather than
  // the file's, for the same reason.
  if (isBootstrapAdmin(email)) {
    const builtInAdmin = DEFAULT_ROLES.find((r) => r.name === 'admin');
    return { role: 'admin', permissions: [...(builtInAdmin?.permissions ?? [])] };
  }

  // Find user override by email (case-insensitive) or userId
  const override = config.users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() || (userId && u.userId === userId)
  );

  const role: UserRole = override?.role ?? config.defaultRole;

  // Get base permissions from role definition
  const roleDef = config.roles.find((r) => r.name === role);
  const basePermissions = roleDef?.permissions ?? [];

  return { role, permissions: mergePermissions(basePermissions, override) };
}

/**
 * Combine a role's permissions with a user's per-user grants and revocations.
 *
 * Revocation is applied last and therefore wins: a permission both granted and
 * revoked for the same user ends up denied. That is the safe direction for a
 * contradictory config, and it is a rule worth pinning down rather than
 * leaving to the order the statements happen to appear in.
 *
 * Split out from `resolveUserPermissions` so it can be tested without a
 * permissions file on disk.
 */
export function mergePermissions(
  basePermissions: Permission[],
  override?: Pick<UserPermissionOverride, 'permissions' | 'revokedPermissions'>
): Permission[] {
  let permissions = [...basePermissions];

  for (const p of override?.permissions ?? []) {
    if (!permissions.includes(p)) permissions.push(p);
  }

  const revoked = override?.revokedPermissions;
  if (revoked?.length) {
    permissions = permissions.filter((p) => !revoked.includes(p));
  }

  return permissions;
}

export function hasPermission(
  sessionPermissions: SessionPermissions,
  permission: Permission
): boolean {
  return sessionPermissions.permissions.includes(permission);
}

export function hasAnyPermission(
  sessionPermissions: SessionPermissions,
  permissions: Permission[]
): boolean {
  return permissions.some((p) => sessionPermissions.permissions.includes(p));
}

// ===== User Override Management =====

export function setUserOverride(override: UserPermissionOverride): void {
  const config = readPermissionsConfig();
  const idx = config.users.findIndex((u) => u.email.toLowerCase() === override.email.toLowerCase());
  if (idx >= 0) {
    config.users[idx] = override;
  } else {
    config.users.push(override);
  }
  writePermissionsConfig(config);
}

export function removeUserOverride(email: string): boolean {
  const config = readPermissionsConfig();
  const idx = config.users.findIndex((u) => u.email.toLowerCase() === email.toLowerCase());
  if (idx >= 0) {
    config.users.splice(idx, 1);
    writePermissionsConfig(config);
    return true;
  }
  return false;
}

// ===== Audit Logging =====

export function appendAuditLog(entry: PermissionAuditEntry): void {
  ensureDataDir();
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(AUDIT_LOG_PATH, line, 'utf-8');
}

export function readAuditLog(limit = 100): PermissionAuditEntry[] {
  if (!existsSync(AUDIT_LOG_PATH)) return [];
  try {
    const raw = readFileSync(AUDIT_LOG_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries = lines.map((line) => JSON.parse(line) as PermissionAuditEntry);
    // Return most recent first, limited
    return entries.reverse().slice(0, limit);
  } catch {
    return [];
  }
}
