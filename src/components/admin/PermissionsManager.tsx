'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Trash2, Loader2, Clock, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type {
  PermissionsConfig,
  UserPermissionOverride,
  UserRole,
  PermissionAuditEntry,
} from '@/types';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  agent: 'Agent',
  client: 'Client',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'var(--priority-urgent)',
  agent: 'var(--primary)',
  client: 'var(--text-muted)',
};

export default function PermissionsManager() {
  const [config, setConfig] = useState<PermissionsConfig | null>(null);
  const [auditLog, setAuditLog] = useState<PermissionAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('agent');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/permissions/config');
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      } else if (response.status === 403) {
        setError('You do not have permission to manage roles.');
      } else {
        setError('Failed to load permissions config.');
      }
    } catch {
      setError('Failed to load permissions config.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAuditLog = useCallback(async () => {
    try {
      const response = await fetch('/api/permissions/audit');
      if (response.ok) {
        const data = await response.json();
        setAuditLog(data.entries || []);
      }
    } catch {
      // Non-critical, ignore
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchAuditLog();
  }, [fetchConfig, fetchAuditLog]);

  const handleDefaultRoleChange = async (role: UserRole) => {
    if (!config) return;
    setSaving(true);
    try {
      const response = await fetch('/api/permissions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultRole: role }),
      });
      if (response.ok) {
        setConfig({ ...config, defaultRole: role });
        fetchAuditLog();
      }
    } catch {
      setError('Failed to update default role.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddUser = async () => {
    if (!newUserEmail.trim()) return;
    setSaving(true);
    try {
      const userId = newUserEmail.toLowerCase();
      const response = await fetch(`/api/permissions/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newUserEmail.trim(),
          displayName: newUserName.trim() || undefined,
          role: newUserRole,
        }),
      });
      if (response.ok) {
        setNewUserEmail('');
        setNewUserName('');
        setNewUserRole('agent');
        setShowAddUser(false);
        fetchConfig();
        fetchAuditLog();
      }
    } catch {
      setError('Failed to add user override.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeRole = async (user: UserPermissionOverride, newRole: UserRole) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/permissions/users/${encodeURIComponent(user.email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          displayName: user.displayName,
          role: newRole,
        }),
      });
      if (response.ok) {
        fetchConfig();
        fetchAuditLog();
      }
    } catch {
      setError('Failed to update user role.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUser = async (email: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/permissions/users/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        fetchConfig();
        fetchAuditLog();
      }
    } catch {
      setError('Failed to remove user override.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="rounded-lg p-6 text-center" style={{ backgroundColor: 'var(--surface)' }}>
        <p style={{ color: 'var(--text-muted)' }}>{error}</p>
      </div>
    );
  }

  if (!config) return null;

  const filteredUsers = config.users.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.displayName?.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
        >
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Default Role */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Default Role
        </h3>
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Role assigned to users who don&apos;t have an explicit override. Changes take effect on
          next sign-in.
        </p>
        <div className="flex gap-2">
          {(['admin', 'agent', 'client'] as UserRole[]).map((role) => (
            <button
              key={role}
              onClick={() => handleDefaultRoleChange(role)}
              disabled={saving}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                config.defaultRole === role ? 'text-white' : 'hover:bg-[var(--surface-hover)]'
              }`}
              style={{
                backgroundColor: config.defaultRole === role ? ROLE_COLORS[role] : 'var(--surface)',
                color: config.defaultRole === role ? 'white' : 'var(--text-secondary)',
              }}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      </div>

      {/* User Overrides */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            User Role Overrides
          </h3>
          <button
            onClick={() => setShowAddUser(!showAddUser)}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--primary)' }}
          >
            <Plus size={14} />
            Add Override
          </button>
        </div>

        {/* Add user form */}
        {showAddUser && (
          <div className="mb-4 rounded-lg p-4" style={{ backgroundColor: 'var(--surface-hover)' }}>
            <div className="grid gap-3 sm:grid-cols-4">
              <input
                type="email"
                placeholder="Email address"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="input text-sm"
              />
              <input
                type="text"
                placeholder="Display name (optional)"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                className="input text-sm"
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="input text-sm"
              >
                <option value="admin">Admin</option>
                <option value="agent">Agent</option>
                <option value="client">Client</option>
              </select>
              <button
                onClick={handleAddUser}
                disabled={saving || !newUserEmail.trim()}
                className="btn-primary text-sm"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        {config.users.length > 3 && (
          <div className="relative mb-3">
            <Search
              size={14}
              className="absolute top-1/2 left-3 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-8 text-sm"
            />
          </div>
        )}

        {/* User table */}
        {filteredUsers.length === 0 ? (
          <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {config.users.length === 0
              ? 'No user overrides. All users use the default role.'
              : 'No matching users.'}
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: 'var(--border)' }}>
                  <th className="pb-2 font-medium" style={{ color: 'var(--text-muted)' }}>
                    User
                  </th>
                  <th className="pb-2 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Role
                  </th>
                  <th className="pb-2 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Updated
                  </th>
                  <th
                    className="pb-2 text-right font-medium"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr
                    key={user.email}
                    className="border-b"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className="py-2">
                      <div>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {user.displayName || user.email}
                        </span>
                        {user.displayName && (
                          <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {user.email}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <select
                        value={user.role}
                        onChange={(e) => handleChangeRole(user, e.target.value as UserRole)}
                        disabled={saving}
                        className="rounded px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: ROLE_COLORS[user.role],
                          color: 'white',
                          border: 'none',
                        }}
                      >
                        <option value="admin">Admin</option>
                        <option value="agent">Agent</option>
                        <option value="client">Client</option>
                      </select>
                    </td>
                    <td className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {user.updatedAt ? new Date(user.updatedAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleRemoveUser(user.email)}
                        disabled={saving}
                        className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
                        style={{ color: 'var(--text-muted)' }}
                        title="Remove override (revert to default role)"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Role Definitions */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Role Definitions
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          {config.roles.map((role) => (
            <div
              key={role.name}
              className="rounded-lg p-3"
              style={{ backgroundColor: 'var(--surface-hover)' }}
            >
              <div className="mb-1 flex items-center gap-2">
                <Shield size={14} style={{ color: ROLE_COLORS[role.name] }} />
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {role.label}
                </span>
              </div>
              <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                {role.description}
              </p>
              <div className="flex flex-wrap gap-1">
                {role.permissions.map((perm) => (
                  <span
                    key={perm}
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Log */}
      <div className="card p-4">
        <button
          onClick={() => {
            setShowAuditLog(!showAuditLog);
            if (!showAuditLog) fetchAuditLog();
          }}
          className="flex w-full items-center justify-between"
        >
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Audit Log
          </h3>
          {showAuditLog ? (
            <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} />
          ) : (
            <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
          )}
        </button>

        {showAuditLog && (
          <div className="mt-3 max-h-64 overflow-auto">
            {auditLog.length === 0 ? (
              <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                No audit entries yet.
              </p>
            ) : (
              <div className="space-y-2">
                {auditLog.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded p-2 text-xs"
                    style={{ backgroundColor: 'var(--surface-hover)' }}
                  >
                    <Clock
                      size={12}
                      className="mt-0.5 shrink-0"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>{entry.details}</span>
                      <div className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        by {entry.performedByEmail} &middot;{' '}
                        {new Date(entry.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
