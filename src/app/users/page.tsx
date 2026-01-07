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
  const [activeList, setActiveList] = useState<'all' | 'suspended'>('all');

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

  const filteredUsers = users.filter(
    (user) =>
      user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <div className="flex h-full">
        {/* Sidebar */}
        <div
          className="w-64 border-r p-4"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <h2 className="mb-4 text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
            User lists
          </h2>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveList('all')}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                activeList === 'all'
                  ? 'bg-[rgba(34,197,94,0.15)] text-[var(--primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              All users
            </button>
            <button
              onClick={() => setActiveList('suspended')}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                activeList === 'suspended'
                  ? 'bg-[rgba(34,197,94,0.15)] text-[var(--primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              Suspended users
            </button>
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-auto p-6">
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
                href="#"
                className="mt-1 flex items-center gap-1 text-sm"
                style={{ color: 'var(--primary)' }}
              >
                Learn about this page <ExternalLink size={12} />
              </a>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-secondary flex items-center gap-2">
                <Upload size={16} /> Bulk import
              </button>
              <button className="btn-primary flex items-center gap-2">
                <Plus size={16} /> Add user
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="mb-6">
            <div className="relative max-w-md">
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
                    <td colSpan={5} className="px-4 py-12">
                      <LoadingSpinner size="lg" message="Loading users..." />
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
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
      </div>
    </MainLayout>
  );
}
