'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { Avatar } from '@/components/common';
import { Search, Plus, Upload, ExternalLink, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Customer } from '@/types';

export default function CustomersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
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
      fetchCustomers();
    }
  }, [session]);

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/devops/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers.map((c: Customer & { lastUpdated: string }) => ({
          ...c,
          lastUpdated: new Date(c.lastUpdated),
        })));
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter((customer) =>
    customer.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email.toLowerCase().includes(searchQuery.toLowerCase())
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
      <div className="flex h-full">
        {/* Sidebar */}
        <div className="w-64 border-r p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-muted)' }}>
            Customer lists
          </h2>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveList('all')}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                activeList === 'all'
                  ? 'bg-[rgba(34,197,94,0.15)] text-[var(--primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              All customers
            </button>
            <button
              onClick={() => setActiveList('suspended')}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
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
        <div className="flex-1 p-6 overflow-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                Customers
              </h1>
              <p style={{ color: 'var(--text-secondary)' }}>
                Add, search, and manage your customers (end users) all in one place.
              </p>
              <a
                href="#"
                className="text-sm flex items-center gap-1 mt-1"
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
                <Plus size={16} /> Add customer
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
                placeholder="Search customers"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input w-full pl-10"
              />
            </div>
          </div>

          {/* Count */}
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''}
          </p>

          {/* Table */}
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="table-header">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" className="rounded" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                    Tags
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                    Timezone
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>
                    Last updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      Loading customers...
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      No customers found
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="table-row">
                      <td className="px-4 py-3">
                        <input type="checkbox" className="rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={customer.displayName} image={customer.avatarUrl} size="sm" />
                          <Link
                            href={`/customers/${customer.id}`}
                            className="font-medium hover:underline"
                            style={{ color: 'var(--primary)' }}
                          >
                            {customer.displayName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {customer.email}
                          </span>
                          {customer.email.includes('@') && (
                            <span title="Email not verified">
                              <AlertTriangle size={14} style={{ color: 'var(--status-open)' }} />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {customer.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {customer.tags.map((tag) => (
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
                        {customer.timezone}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {format(customer.lastUpdated, 'dd MMM yyyy')}
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
