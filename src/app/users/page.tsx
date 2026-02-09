'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { Avatar, LoadingSpinner } from '@/components/common';
import { Search, Plus, Upload, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Customer } from '@/types';

export default function UsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [accessLevelFilter, setAccessLevelFilter] = useState<string>('all');
  const [showNotImplemented, setShowNotImplemented] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchUsers();
    }
  }, [session]);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/devops/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(
          data.users.map((c: Customer & { lastUpdated?: string }) => ({
            ...c,
            lastUpdated: c.lastUpdated ? new Date(c.lastUpdated) : undefined,
          }))
        );
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  // Get unique email domains for filter dropdown
  const emailDomains = Array.from(
    new Set(users.map((user) => user.email.split('@')[1]).filter(Boolean))
  ).sort();

  // Get unique access levels for filter dropdown
  const accessLevels = Array.from(
    new Set(users.map((user) => user.license).filter(Boolean))
  ).sort();

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDomain = domainFilter === 'all' || user.email.endsWith(`@${domainFilter}`);
    const matchesAccessLevel = accessLevelFilter === 'all' || user.license === accessLevelFilter;
    return matchesSearch && matchesDomain && matchesAccessLevel;
  });

  const handleNotImplemented = () => {
    setShowNotImplemented(true);
    setTimeout(() => setShowNotImplemented(false), 3000);
  };

  if (status === 'loading') {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <MainLayout>
      <div className="flex-1 overflow-auto p-6">
        {/* Not implemented toast */}
        {showNotImplemented && (
          <div
            className="fixed top-4 right-4 z-50 rounded-lg border px-4 py-3 shadow-lg"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <p className="font-medium">Not yet implemented</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Please manage users in{' '}
              <a
                href="https://dev.azure.com/KnowAll/_settings/users"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: 'var(--primary)' }}
              >
                Azure DevOps
              </a>
            </p>
          </div>
        )}

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Users
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Search and manage your users all in one place.
            </p>
            <a
              href="https://dev.azure.com/KnowAll/_settings/users"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1 text-sm"
              style={{ color: 'var(--primary)' }}
            >
              See users in Azure DevOps <ExternalLink size={12} />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNotImplemented}
              className="btn-secondary flex items-center gap-2"
            >
              <Upload size={16} /> Bulk import
            </button>
            <button onClick={handleNotImplemented} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> Add user
            </button>
          </div>
        </div>

        {/* Search and filters */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="relative max-w-md flex-1">
            <Search
              size={18}
              className="absolute top-1/2 left-3 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Search users"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-10"
            />
          </div>
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="input"
          >
            <option value="all">All domains</option>
            {emailDomains.map((domain) => (
              <option key={domain} value={domain}>
                @{domain}
              </option>
            ))}
          </select>
          <select
            value={accessLevelFilter}
            onChange={(e) => setAccessLevelFilter(e.target.value)}
            className="input"
          >
            <option value="all">All access levels</option>
            {accessLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        {/* Count */}
        <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
        </p>

        {/* Table */}
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="table-header">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" className="rounded" />
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Name
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Email
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Access Level
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Timezone
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Last updated
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12">
                    <LoadingSpinner size="lg" message="Loading users..." />
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    No users found
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="table-row">
                    <td className="px-4 py-3">
                      <input type="checkbox" className="rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.displayName} image={user.avatarUrl} size="sm" />
                        <Link
                          href={`/users/${user.id}`}
                          className="font-medium hover:underline"
                          style={{ color: 'var(--primary)' }}
                        >
                          {user.displayName}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {user.email}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {user.license || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {user.timezone}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {user.lastUpdated ? format(user.lastUpdated, 'dd MMM yyyy') : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
}
