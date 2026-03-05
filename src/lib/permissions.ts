import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
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

export function readPermissionsConfig(): PermissionsConfig {
  ensureDataDir();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as PermissionsConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
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
  const config = readPermissionsConfig();

  // Find user override by email (case-insensitive) or userId
  const override = config.users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() || (userId && u.userId === userId)
  );

  const role: UserRole = override?.role ?? config.defaultRole;

  // Get base permissions from role definition
  const roleDef = config.roles.find((r) => r.name === role);
  const basePermissions = roleDef?.permissions ?? [];

  // Apply overrides
  let permissions = [...basePermissions];

  if (override?.permissions) {
    // Add extra permissions
    for (const p of override.permissions) {
      if (!permissions.includes(p)) {
        permissions.push(p);
      }
    }
  }

  if (override?.revokedPermissions) {
    // Remove revoked permissions
    permissions = permissions.filter((p) => !override.revokedPermissions!.includes(p));
  }

  return { role, permissions };
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
