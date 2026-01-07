'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { Avatar } from '@/components/common';
import { User, Mail, Building2, Clock, Globe, ExternalLink, Loader2 } from 'lucide-react';

interface DevOpsProfile {
  id: string;
  displayName: string;
  email: string;
  timezone: string;
  locale: string;
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<DevOpsProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const response = await fetch('/api/devops/profile');
        if (response.ok) {
          const data = await response.json();
          setProfile(data);
        } else {
          setError('Failed to load profile from Azure DevOps');
        }
      } catch {
        setError('Failed to connect to Azure DevOps');
      } finally {
        setLoading(false);
      }
    }

    if (session?.accessToken) {
      fetchProfile();
    }
  }, [session]);

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

  if (error) {
    return (
      <MainLayout>
        <div className="mx-auto max-w-3xl p-6">
          <div
            className="card p-6 text-center"
            style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
          >
            <p style={{ color: 'var(--priority-urgent)' }}>{error}</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="mx-auto max-w-3xl p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Profile
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Your account information from Azure DevOps.
          </p>
        </div>

        {/* Profile Card */}
        <div className="card mb-6 p-6">
          <div className="mb-6 flex items-center gap-4">
            <Avatar
              name={profile?.displayName || session.user?.name || 'User'}
              image={session.user?.image ?? undefined}
              size="lg"
            />
            <div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {profile?.displayName || session.user?.name || 'User'}
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Signed in via Microsoft Azure AD
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <User size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Display Name
                </p>
                <p style={{ color: 'var(--text-primary)' }}>
                  {profile?.displayName || session.user?.name || 'Not set'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Mail size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Email
                </p>
                <p style={{ color: 'var(--text-primary)' }}>
                  {profile?.email || session.user?.email || 'Not set'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Building2 size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Account Provider
                </p>
                <p style={{ color: 'var(--text-primary)' }}>Microsoft Azure AD</p>
              </div>
            </div>
          </div>
        </div>

        {/* Settings Card */}
        <div className="card p-6">
          <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Settings
          </h3>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Clock size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Timezone
                </p>
                <p style={{ color: 'var(--text-primary)' }}>
                  {profile?.timezone?.replace(/_/g, ' ') || 'UTC'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Globe size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Locale
                </p>
                <p style={{ color: 'var(--text-primary)' }}>{profile?.locale || 'en-US'}</p>
              </div>
            </div>

            <div className="pt-4">
              <a
                href="https://dev.azure.com/KnowAll/_usersSettings/general"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex items-center gap-2"
              >
                <ExternalLink size={16} />
                Edit Settings in Azure DevOps
              </a>
            </div>
          </div>
        </div>

        {/* Info Note */}
        <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          Your profile settings are managed in Azure DevOps. Changes made there will be reflected
          here after signing out and back in.
        </p>
      </div>
    </MainLayout>
  );
}
