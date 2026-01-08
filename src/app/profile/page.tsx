'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { Avatar } from '@/components/common';
import { useProfilePhoto } from '@/hooks';
import {
  User,
  Mail,
  MapPin,
  Clock,
  Globe,
  Calendar,
  Languages,
  ExternalLink,
  Loader2,
  Zap,
  Save,
  Check,
} from 'lucide-react';

interface DevOpsProfile {
  id: string;
  displayName: string;
  email: string;
  timezone: string;
  locale: string;
  country: string;
  datePattern: string;
  timePattern: string;
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const { photoUrl } = useProfilePhoto(status === 'authenticated');
  const router = useRouter();
  const [profile, setProfile] = useState<DevOpsProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lightning address state
  const [lightningAddress, setLightningAddress] = useState('');
  const [lightningAddressSaved, setLightningAddressSaved] = useState(false);
  const [isSavingLightning, setIsSavingLightning] = useState(false);

  // Load lightning address from localStorage
  const loadLightningAddress = useCallback(() => {
    if (typeof window !== 'undefined' && session?.user?.email) {
      const stored = localStorage.getItem(`devdesk_lightning_${session.user.email}`);
      if (stored) {
        setLightningAddress(stored);
      }
    }
  }, [session?.user?.email]);

  useEffect(() => {
    loadLightningAddress();
  }, [loadLightningAddress]);

  const saveLightningAddress = async () => {
    if (!session?.user?.email) return;
    setIsSavingLightning(true);
    try {
      localStorage.setItem(`devdesk_lightning_${session.user.email}`, lightningAddress);
      setLightningAddressSaved(true);
      setTimeout(() => setLightningAddressSaved(false), 2000);
    } finally {
      setIsSavingLightning(false);
    }
  };

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
              image={photoUrl ?? undefined}
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

          <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Profile
          </h3>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <User size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Full Name
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
                  Contact Email
                </p>
                <p style={{ color: 'var(--text-primary)' }}>
                  {profile?.email || session.user?.email || 'Not set'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MapPin size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Country/Region
                </p>
                <p style={{ color: 'var(--text-primary)' }}>{profile?.country || 'Unknown'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Lightning Payments Card */}
        <div className="card mb-6 p-6">
          <div className="mb-4 flex items-center gap-2">
            <Zap size={20} style={{ color: '#f7931a' }} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Lightning Payments
            </h3>
          </div>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Configure your Lightning address to receive tips from satisfied customers.
          </p>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="lightning-address"
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Lightning Address
              </label>
              <div className="flex gap-2">
                <input
                  id="lightning-address"
                  type="text"
                  placeholder="yourname@getalby.com"
                  value={lightningAddress}
                  onChange={(e) => setLightningAddress(e.target.value)}
                  className="input flex-1"
                />
                <button
                  onClick={saveLightningAddress}
                  disabled={isSavingLightning}
                  className="btn-primary flex items-center gap-2"
                >
                  {lightningAddressSaved ? (
                    <>
                      <Check size={16} />
                      Saved
                    </>
                  ) : isSavingLightning ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <>
                      <Save size={16} />
                      Save
                    </>
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Enter your Lightning address (e.g., name@getalby.com) or LNURL to receive zaps.
              </p>
            </div>
          </div>
        </div>

        {/* Time and Locale Card */}
        <div className="card mb-6 p-6">
          <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Time and Locale
          </h3>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Languages size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Preferred Language
                </p>
                <p style={{ color: 'var(--text-primary)' }}>{profile?.locale || 'Unknown'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Date Pattern
                </p>
                <p style={{ color: 'var(--text-primary)' }}>{profile?.datePattern || 'Unknown'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Clock size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Time Pattern
                </p>
                <p style={{ color: 'var(--text-primary)' }}>{profile?.timePattern || 'Unknown'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Globe size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Time Zone
                </p>
                <p style={{ color: 'var(--text-primary)' }}>
                  {profile?.timezone?.replace(/_/g, ' ') || 'Unknown'}
                </p>
              </div>
            </div>

            <div className="pt-4">
              <a
                href="https://dev.azure.com/KnowAll/_usersSettings/about"
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
