'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { ArrowLeft, ExternalLink, Ticket, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Organization, Ticket as TicketType } from '@/types';

export default function OrganizationDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [tickets, setTickets] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);

  const orgId = params.id as string;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken && orgId) {
      fetchOrganization();
      fetchOrgTickets();
    }
  }, [session, orgId]);

  const fetchOrganization = async () => {
    try {
      const response = await fetch('/api/devops/organizations');
      if (response.ok) {
        const data = await response.json();
        const org = data.organizations.find(
          (o: Organization) => o.id === orgId || o.devOpsProject === orgId
        );
        if (org) {
          setOrganization({
            ...org,
            createdAt: new Date(org.createdAt),
            updatedAt: new Date(org.updatedAt),
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch organization:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrgTickets = async () => {
    try {
      const response = await fetch(`/api/devops/tickets?organization=${encodeURIComponent(orgId)}`);
      if (response.ok) {
        const data = await response.json();
        setTickets(data.tickets || []);
      }
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  if (!organization) {
    return (
      <MainLayout>
        <div className="p-6">
          <Link
            href="/organizations"
            className="mb-4 flex items-center gap-2 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={16} /> Back to organizations
          </Link>
          <div className="card p-8 text-center">
            <p style={{ color: 'var(--text-muted)' }}>Organization not found</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6">
        {/* Back link */}
        <Link
          href="/organizations"
          className="mb-4 flex items-center gap-2 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={16} /> Back to organizations
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {organization.name}
          </h1>
          {organization.domain && (
            <p style={{ color: 'var(--text-secondary)' }}>{organization.domain}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Details card */}
          <div className="card p-6">
            <h2 className="mb-4 font-semibold" style={{ color: 'var(--text-primary)' }}>
              Details
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Domain:</span>
                <p style={{ color: 'var(--text-primary)' }}>{organization.domain || '-'}</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>DevOps Project:</span>
                <p style={{ color: 'var(--text-primary)' }}>{organization.devOpsProject}</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Created:</span>
                <p style={{ color: 'var(--text-primary)' }}>
                  {format(organization.createdAt, 'dd MMM yyyy')}
                </p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Last updated:</span>
                <p style={{ color: 'var(--text-primary)' }}>
                  {format(organization.updatedAt, 'dd MMM yyyy')}
                </p>
              </div>
              {organization.tags.length > 0 && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tags:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {organization.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded px-2 py-0.5 text-xs"
                        style={{
                          backgroundColor: 'var(--surface-hover)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <a
                href={`https://dev.azure.com/${organization.devOpsOrg}/${encodeURIComponent(organization.devOpsProject)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm"
                style={{ color: 'var(--primary)' }}
              >
                View in Azure DevOps <ExternalLink size={12} />
              </a>
            </div>
          </div>

          {/* Tickets card */}
          <div className="card lg:col-span-2">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <Ticket size={18} style={{ color: 'var(--primary)' }} />
                <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Tickets ({tickets.length})
                </h2>
              </div>
            </div>
            <div className="p-4">
              {tickets.length === 0 ? (
                <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No tickets for this organization
                </p>
              ) : (
                <div className="space-y-2">
                  {tickets.slice(0, 10).map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="block rounded p-3 transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {ticket.title}
                          </p>
                          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                            #{ticket.id} - {ticket.status}
                          </p>
                        </div>
                        <span
                          className={`status-badge status-${ticket.status.toLowerCase().replace(' ', '-')}`}
                        >
                          {ticket.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {tickets.length > 10 && (
                    <Link
                      href={`/tickets?organization=${orgId}`}
                      className="block pt-2 text-center text-sm"
                      style={{ color: 'var(--primary)' }}
                    >
                      View all {tickets.length} tickets
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
