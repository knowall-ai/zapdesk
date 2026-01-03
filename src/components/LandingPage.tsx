'use client';

import { signIn } from 'next-auth/react';
import {
  Ticket,
  Users,
  BarChart3,
  FolderKanban,
  CheckCircle,
} from 'lucide-react';

const features = [
  {
    icon: <Ticket size={24} />,
    title: 'Zendesk-Style Interface',
    description: 'A familiar support portal experience for managing tickets, customers, and organizations from Azure DevOps.',
  },
  {
    icon: <FolderKanban size={24} />,
    title: 'Azure DevOps Backend',
    description: 'Uses your existing DevOps work items as tickets. No new database or data migration required.',
  },
  {
    icon: <BarChart3 size={24} />,
    title: 'Insightful Reports',
    description: 'Track ticket volumes, response times, SLA compliance, and team performance with built-in dashboards.',
  },
  {
    icon: <Users size={24} />,
    title: 'Customer Management',
    description: 'View tickets by customer or organization. Route emails to the right DevOps project automatically.',
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
      <header className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <span className="text-white font-bold">D</span>
            </div>
            <span className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
              DevDesk
            </span>
          </div>
          <button
            onClick={() => signIn('azure-ad', { callbackUrl: '/' })}
            className="btn-primary text-sm py-2 px-4"
          >
            Sign in with Microsoft
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
            Everything You Need for Support Ticketing
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Built specifically for teams using Azure DevOps who need a modern, efficient way
            to manage and track support tickets.
          </p>
        </div>
      </section>

      {/* Features - 2 column grid */}
      <section className="py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="card p-6"
              >
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                  style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', color: 'var(--primary)' }}
                >
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
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

      {/* Built for KnowAll.ai Teams */}
      <section className="py-16 px-4" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left side - Text */}
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                Built for{' '}
                <span style={{ color: 'var(--primary)' }}>KnowAll.ai</span>
                {' '}Teams
              </h2>
              <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                DevDesk is designed exclusively for KnowAll.ai users, providing a
                seamless experience for managing support tickets against Azure DevOps
                projects.
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
            <div
              className="card p-8 text-center"
            >
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-6"
                style={{ backgroundColor: 'var(--surface-hover)' }}
              >
                <svg width="32" height="32" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Sign in with Microsoft
              </h3>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                Use your KnowAll.ai Microsoft account to access DevDesk securely.
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
      <footer className="py-6 px-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <span className="text-white font-bold">D</span>
            </div>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              DevDesk
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
              href="https://github.com/knowall-ai/devdesk"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              GitHub
            </a>
            <a
              href="mailto:support@knowall.ai"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
