'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { Settings, Code2, CheckCircle, XCircle } from 'lucide-react';
import { getSupportedTemplates, getTemplateConfig } from '@/config/process-templates';

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

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

  const supportedTemplates = getSupportedTemplates();

  return (
    <MainLayout>
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <Settings size={28} style={{ color: 'var(--primary)' }} />
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Admin Settings
            </h1>
          </div>
          <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>
            System configuration and process template management.
          </p>
        </div>

        {/* Process Templates Section */}
        <section className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <Code2 size={20} style={{ color: 'var(--text-muted)' }} />
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Process Template Configurations
            </h2>
          </div>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            DevDesk supports the following Azure DevOps process templates. Projects using
            unsupported templates will display a warning.
          </p>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {supportedTemplates.map((templateName) => {
              const config = getTemplateConfig(templateName);
              return (
                <div key={config.id} className="card p-4" style={{ borderColor: 'var(--border)' }}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {config.name}
                    </h3>
                    <CheckCircle size={18} className="text-green-500" />
                  </div>

                  {/* Work Item Types */}
                  <div className="mb-3">
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Default Ticket Type
                    </p>
                    <span
                      className="rounded bg-[var(--surface-hover)] px-2 py-1 text-sm"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {config.workItemTypes.ticket}
                    </span>
                  </div>

                  {/* Priority Field */}
                  <div className="mb-3">
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Priority Field
                    </p>
                    {config.fields.priority ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle size={14} className="text-green-500" />
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          Supported
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <XCircle size={14} className="text-red-400" />
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Not available
                        </span>
                      </div>
                    )}
                  </div>

                  {/* States */}
                  <div className="mb-3">
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      State Mappings
                    </p>
                    <div className="space-y-1 text-xs">
                      {config.states.proposed.length > 0 && (
                        <div className="flex gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>Proposed:</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {config.states.proposed.join(', ')}
                          </span>
                        </div>
                      )}
                      {config.states.inProgress.length > 0 && (
                        <div className="flex gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>In Progress:</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {config.states.inProgress.join(', ')}
                          </span>
                        </div>
                      )}
                      {config.states.resolved.length > 0 && (
                        <div className="flex gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>Resolved:</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {config.states.resolved.join(', ')}
                          </span>
                        </div>
                      )}
                      {config.states.closed.length > 0 && (
                        <div className="flex gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>Closed:</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {config.states.closed.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Supported Types */}
                  <div>
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Supported Work Item Types
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {config.workItemTypes.supportedTypes.map((type) => (
                        <span
                          key={type}
                          className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-xs"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Request new template link */}
          <div className="mt-4">
            <a
              href="https://github.com/knowall-ai/devdesk/issues/new?title=Support%20for%20new%20process%20template&labels=enhancement"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:underline"
              style={{ color: 'var(--primary)' }}
            >
              Request support for a new process template &rarr;
            </a>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
