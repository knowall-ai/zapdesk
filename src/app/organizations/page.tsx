'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { Search, Plus, Upload, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Organization } from '@/types';

export default function OrganizationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchOrganizations();
    }
  }, [session]);

  const fetchOrganizations = async () => {
    try {
      const response = await fetch('/api/devops/organizations');
      if (response.ok) {
        const data = await response.json();
        setOrganizations(data.organizations.map((o: Organization & { createdAt: string; updatedAt: string }) => ({
          ...o,
          createdAt: new Date(o.createdAt),
          updatedAt: new Date(o.updatedAt),
        })));
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredOrganizations = organizations.filter((org) =>
    org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    org.domain?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (status === 'loading') {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--primary)' }} />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <MainLayout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              Organizations
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Add, search, and manage your organizations all in one place.
            </p>
            <a
              href="#"
              className="text-sm flex items-center gap-1 mt-1"
              style={{ color: 'var(--primary)' }}
            >
              Learn about organizations <ExternalLink size={12} />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2">
              <Upload size={16} /> Bulk import
            </button>
            <button className="btn-primary flex items-center gap-2">
              <Plus size={16} /> Add organization
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Search organizations"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-10"
            />
          </div>
        </div>

        {/* Count */}
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          {filteredOrganizations.length} organization{filteredOrganizations.length !== 1 ? 's' : ''}
        </p>

        {/* Table */}
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                  Domain
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                  Tags
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                  Created at
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                  Last updated
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    Loading organizations...
                  </td>
                </tr>
              ) : filteredOrganizations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    No organizations found
                  </td>
                </tr>
              ) : (
                filteredOrganizations.map((org) => (
                  <tr key={org.id} className="table-row">
                    <td className="px-4 py-3">
                      <Link
                        href={`/organizations/${org.id}`}
                        className="font-medium hover:underline"
                        style={{ color: 'var(--primary)' }}
                      >
                        {org.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {org.domain || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {org.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {org.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 text-xs rounded"
                              style={{ backgroundColor: 'var(--surface-hover)', color: 'var(--text-secondary)' }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(org.createdAt, 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(org.updatedAt, 'dd MMM yyyy')}
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
