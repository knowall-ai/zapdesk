'use client';

import { signIn } from 'next-auth/react';
import { Ticket, Users, BarChart3, FolderKanban, CheckCircle } from 'lucide-react';
import ZapDeskIcon from '@/components/common/ZapDeskIcon';

const features = [
  {
    icon: <Ticket size={24} />,
    title: 'Modern Support Portal',
    description:
      'A familiar support portal experience for managing tickets, customers, and organizations from Azure DevOps.',
  },
  {
    icon: <FolderKanban size={24} />,
    title: 'Azure DevOps Backend',
    description:
      'Uses your existing DevOps work items as tickets. No new database or data migration required.',
  },
  {
    icon: <BarChart3 size={24} />,
    title: 'Insightful Reports',
    description:
      'Track ticket volumes, response times, SLA compliance, and team performance with built-in dashboards.',
  },
  {
    icon: <Users size={24} />,
    title: 'Customer Management',
    description:
      'View tickets by customer or organization. Route emails to the right DevOps project automatically.',
  },
];

const benefits = [
  'Seamless Microsoft Entra ID authentication',
  'Real-time sync with Azure DevOps',
  'Email-to-ticket creation',
  'SLA tracking and management',
  'Works with existing DevOps permissions',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {/* Header */}
      <header className="border-b px-4 py-4" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <ZapDeskIcon size={32} />
            <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              ZapDesk
            </span>
          </div>
          <button
            onClick={() => signIn('azure-ad', { callbackUrl: '/' })}
            className="btn-primary px-4 py-2 text-sm"
          >
            Sign in with Microsoft
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1
            className="mb-4 text-3xl font-bold sm:text-4xl lg:text-5xl"
            style={{ color: 'var(--text-primary)' }}
          >
            Everything You Need for Support Ticketing
          </h1>
          <p
            className="mx-auto max-w-2xl text-base sm:text-lg"
            style={{ color: 'var(--text-secondary)' }}
          >
            Built specifically for teams using Azure DevOps who need a modern, efficient way to
            manage and track support tickets.
          </p>
        </div>
      </section>

      {/* Features - 2 column grid */}
      <section className="px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title} className="card p-6">
                <div
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg"
                  style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', color: 'var(--primary)' }}
                >
                  {feature.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {feature.title}
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Open Source by KnowAll.ai */}
      <section className="px-4 py-16" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            {/* Left side - Text */}
            <div>
              <h2
                className="mb-4 text-2xl font-bold sm:text-3xl"
                style={{ color: 'var(--text-primary)' }}
              >
                Open Source by <span style={{ color: 'var(--primary)' }}>KnowAll.ai</span>
              </h2>
              <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                ZapDesk provides a seamless experience for managing support tickets against Azure
                DevOps projects. Free and open source for everyone.
              </p>
              <div className="space-y-3">
                {benefits.map((benefit) => (
                  <div key={benefit} className="flex items-center gap-3">
                    <CheckCircle size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-primary)' }}>{benefit}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right side - Sign in card */}
            <div className="card p-8 text-center">
              <div
                className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-xl"
                style={{ backgroundColor: 'var(--surface-hover)' }}
              >
                <svg width="32" height="32" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                Sign in with Microsoft
              </h3>
              <p className="mb-6 text-sm" style={{ color: 'var(--text-muted)' }}>
                Use your Microsoft account to access ZapDesk securely.
              </p>
              <button
                onClick={() => signIn('azure-ad', { callbackUrl: '/' })}
                className="btn-primary w-full py-3 text-base"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-4 py-6" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <ZapDeskIcon size={32} />
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              ZapDesk
            </span>
            <span style={{ color: 'var(--text-muted)' }}>by</span>
            <a
              href="https://www.knowall.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold hover:underline"
              style={{ color: 'var(--primary)' }}
            >
              KnowAll.ai
            </a>
          </div>
          <div className="flex items-center gap-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            <a
              href="https://github.com/knowall-ai/zapdesk"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              GitHub
            </a>
            <a
              href="mailto:support@knowall.ai"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
