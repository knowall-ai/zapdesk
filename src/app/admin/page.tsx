'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner, AzureDevOpsIcon } from '@/components/common';
import {
  Settings,
  Code2,
  CheckCircle,
  XCircle,
  Mail,
  Send,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
} from 'lucide-react';
import { getSupportedTemplates, getTemplateConfig } from '@/config/process-templates';

interface EmailConfig {
  outbound: {
    configured: boolean;
    method: string;
    from: string | null;
    fromName: string | null;
    azureAdConfigured: boolean;
  };
  inbound: {
    webhookConfigured: boolean;
    patConfigured: boolean;
    ready: boolean;
  };
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);
  const [emailConfigLoading, setEmailConfigLoading] = useState(true);
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchEmailConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/email/config');
      if (res.ok) {
        setEmailConfig(await res.json());
      }
    } catch {
      // silently fail — section will show as unconfigured
    } finally {
      setEmailConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchEmailConfig();
    }
  }, [session, fetchEmailConfig]);

  const handleSendTestEmail = async () => {
    if (!testEmail || testSending) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ success: true, message: data.message });
      } else {
        setTestResult({ success: false, message: data.error || 'Failed to send test email' });
      }
    } catch {
      setTestResult({ success: false, message: 'Network error' });
    } finally {
      setTestSending(false);
    }
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
            ZapDesk supports the following Azure DevOps process templates. Projects using
            unsupported templates will display a warning.
          </p>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {supportedTemplates.map((templateName) => {
              const config = getTemplateConfig(templateName);
              return (
                <div key={config.id} className="card p-4" style={{ borderColor: 'var(--border)' }}>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AzureDevOpsIcon size={20} />
                      <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {config.name}
                      </h3>
                    </div>
                    <CheckCircle size={18} className="text-green-500" />
                  </div>

                  {/* Ticket Types */}
                  <div className="mb-3">
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Ticket Work Item Types
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {config.workItemTypes.ticketTypes.map((type) => (
                        <span
                          key={type}
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            type === config.workItemTypes.defaultTicketType
                              ? 'bg-[rgba(34,197,94,0.15)] font-medium'
                              : 'bg-[var(--surface-hover)]'
                          }`}
                          style={{
                            color:
                              type === config.workItemTypes.defaultTicketType
                                ? 'var(--primary)'
                                : 'var(--text-muted)',
                          }}
                        >
                          {type}
                          {type === config.workItemTypes.defaultTicketType && ' (default)'}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs italic" style={{ color: 'var(--text-muted)' }}>
                      Must be tagged with &quot;ticket&quot; tag
                    </p>
                  </div>

                  {/* Feature Type */}
                  <div className="mb-3">
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Feature Work Item Type
                    </p>
                    {config.workItemTypes.featureType ? (
                      <span
                        className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-xs"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {config.workItemTypes.featureType}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <XCircle size={14} className="text-red-400" />
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Not available
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Epic Type */}
                  <div className="mb-3">
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Epic Work Item Type
                    </p>
                    <span
                      className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {config.workItemTypes.epicType}
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
                  <div>
                    <p
                      className="mb-1 text-xs font-medium uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      State Mappings
                    </p>
                    <div className="space-y-1 text-xs">
                      {config.states.new.length > 0 && (
                        <div className="flex gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>New:</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {config.states.new.join(', ')}
                          </span>
                        </div>
                      )}
                      {config.states.active.length > 0 && (
                        <div className="flex gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>Active:</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {config.states.active.join(', ')}
                          </span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <span style={{ color: 'var(--text-muted)' }}>Resolved:</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {config.states.resolved.length > 0
                            ? config.states.resolved.join(', ')
                            : 'N/A'}
                        </span>
                      </div>
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
                </div>
              );
            })}
          </div>

          {/* Request new template link */}
          <div className="mt-4">
            <a
              href="https://github.com/knowall-ai/zapdesk/issues/new?title=Support%20for%20new%20process%20template&labels=enhancement"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:underline"
              style={{ color: 'var(--primary)' }}
            >
              Request support for a new process template &rarr;
            </a>
          </div>
        </section>

        {/* Email Channel Section */}
        <section className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <Mail size={20} style={{ color: 'var(--text-muted)' }} />
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Email Channel
            </h2>
          </div>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            Email integration allows customers to create and update tickets by sending emails to
            your support address.
          </p>

          {emailConfigLoading ? (
            <div className="flex items-center gap-2 py-8">
              <LoadingSpinner size="sm" />
              <span style={{ color: 'var(--text-muted)' }}>Loading email configuration...</span>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Outbound Card */}
              <div className="card p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowUpFromLine size={18} style={{ color: 'var(--text-muted)' }} />
                    <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      Outbound (Graph API)
                    </h3>
                  </div>
                  {emailConfig?.outbound.configured ? (
                    <CheckCircle size={18} className="text-green-500" />
                  ) : (
                    <XCircle size={18} className="text-red-400" />
                  )}
                </div>

                {emailConfig?.outbound.configured ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>Method</span>
                      <span style={{ color: 'var(--text-secondary)' }}>Microsoft Graph API</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>From</span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {emailConfig.outbound.fromName} &lt;{emailConfig.outbound.from}&gt;
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>Azure AD App</span>
                      <CheckCircle size={14} className="text-green-500" />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Set <code className="text-xs">MAIL_FROM</code> (shared mailbox address) and
                    ensure Azure AD app has <code className="text-xs">Mail.Send</code> permission.
                  </p>
                )}
              </div>

              {/* Inbound Card */}
              <div className="card p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowDownToLine size={18} style={{ color: 'var(--text-muted)' }} />
                    <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      Inbound (Webhook)
                    </h3>
                  </div>
                  {emailConfig?.inbound.ready ? (
                    <CheckCircle size={18} className="text-green-500" />
                  ) : (
                    <XCircle size={18} className="text-red-400" />
                  )}
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Webhook Secret</span>
                    {emailConfig?.inbound.webhookConfigured ? (
                      <CheckCircle size={14} className="text-green-500" />
                    ) : (
                      <XCircle size={14} className="text-red-400" />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Service Account (PAT)</span>
                    {emailConfig?.inbound.patConfigured ? (
                      <CheckCircle size={14} className="text-green-500" />
                    ) : (
                      <XCircle size={14} className="text-red-400" />
                    )}
                  </div>
                  {!emailConfig?.inbound.ready && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Set <code className="text-xs">EMAIL_WEBHOOK_SECRET</code> and{' '}
                      <code className="text-xs">AZURE_DEVOPS_PAT</code> to enable inbound email.
                    </p>
                  )}
                  {emailConfig?.inbound.ready && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Webhook endpoint: <code className="text-xs">/api/email/webhook</code>
                    </p>
                  )}
                </div>
              </div>

              {/* Send Test Email Card */}
              <div className="card p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="mb-3 flex items-center gap-2">
                  <Send size={18} style={{ color: 'var(--text-muted)' }} />
                  <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    Send Test Email
                  </h3>
                </div>

                {emailConfig?.outbound.configured ? (
                  <div className="space-y-3">
                    <input
                      type="email"
                      placeholder="recipient@example.com"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendTestEmail()}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <button
                      onClick={handleSendTestEmail}
                      disabled={!testEmail || testSending}
                      className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      {testSending ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send size={14} />
                          Send Test
                        </>
                      )}
                    </button>
                    {testResult && (
                      <div
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
                        style={{
                          backgroundColor: testResult.success
                            ? 'rgba(34,197,94,0.1)'
                            : 'rgba(239,68,68,0.1)',
                          color: testResult.success ? '#22c55e' : '#ef4444',
                        }}
                      >
                        {testResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {testResult.message}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Configure SMTP settings to send a test email.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Email features summary */}
          <div className="mt-4 rounded-lg p-4" style={{ backgroundColor: 'var(--surface-hover)' }}>
            <p
              className="mb-2 text-xs font-medium uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              Email Features
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              {[
                { label: 'Email-to-ticket', ready: emailConfig?.inbound.ready },
                { label: 'Thread detection', ready: emailConfig?.inbound.ready },
                { label: 'Attachment processing', ready: emailConfig?.inbound.ready },
                { label: 'Agent reply notifications', ready: emailConfig?.outbound.configured },
                { label: 'Status change notifications', ready: emailConfig?.outbound.configured },
                { label: 'HTML email templates', ready: emailConfig?.outbound.configured },
              ].map((feature) => (
                <div key={feature.label} className="flex items-center gap-1.5">
                  {feature.ready ? (
                    <CheckCircle size={12} className="shrink-0 text-green-500" />
                  ) : (
                    <XCircle size={12} className="shrink-0 text-red-400" />
                  )}
                  <span style={{ color: 'var(--text-secondary)' }}>{feature.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
