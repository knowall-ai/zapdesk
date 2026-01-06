'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { MainLayout } from '@/components/layout';
import { Avatar } from '@/components/common';
import { User, Mail, Building2, Clock, Globe, Save, Check } from 'lucide-react';

const TIMEZONE_OPTIONS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];

interface ProfilePreferences {
  timezone: string;
  locale: string;
}

function getStoredPreferences(): ProfilePreferences {
  if (typeof window === 'undefined') {
    return { timezone: 'UTC', locale: 'en-US' };
  }
  try {
    const stored = localStorage.getItem('devdesk-profile-preferences');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return { timezone: 'UTC', locale: 'en-US' };
}

function savePreferences(preferences: ProfilePreferences): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('devdesk-profile-preferences', JSON.stringify(preferences));
  }
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [preferences, setPreferences] = useState<ProfilePreferences>(getStoredPreferences);
  const [saved, setSaved] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleSave = () => {
    savePreferences(preferences);
    setSaved(true);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => setSaved(false), 2000);
  };

  if (status === 'loading') {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--primary)' }}
          />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
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
            View and manage your account information and preferences.
          </p>
        </div>

        {/* Profile Card */}
        <div className="card mb-6 p-6">
          <div className="mb-6 flex items-center gap-4">
            <Avatar
              name={session.user?.name || 'User'}
              image={session.user?.image ?? undefined}
              size="lg"
            />
            <div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {session.user?.name || 'User'}
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
                <p style={{ color: 'var(--text-primary)' }}>{session.user?.name || 'Not set'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Mail size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Email
                </p>
                <p style={{ color: 'var(--text-primary)' }}>{session.user?.email || 'Not set'}</p>
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

        {/* Preferences Card */}
        <div className="card p-6">
          <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Preferences
          </h3>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="timezone"
                className="mb-1 flex items-center gap-2 text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Clock size={16} />
                Timezone
              </label>
              <select
                id="timezone"
                value={preferences.timezone}
                onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })}
                className="input w-full"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="locale"
                className="mb-1 flex items-center gap-2 text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Globe size={16} />
                Locale
              </label>
              <select
                id="locale"
                value={preferences.locale}
                onChange={(e) => setPreferences({ ...preferences, locale: e.target.value })}
                className="input w-full"
              >
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="de-DE">German</option>
                <option value="fr-FR">French</option>
                <option value="es-ES">Spanish</option>
                <option value="ja-JP">Japanese</option>
                <option value="zh-CN">Chinese (Simplified)</option>
              </select>
            </div>

            <div className="pt-4">
              <button
                type="button"
                onClick={handleSave}
                className="btn-primary flex items-center gap-2"
              >
                {saved ? (
                  <>
                    <Check size={16} />
                    Saved
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Save Preferences
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Info Note */}
        <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          Your profile information is managed through Microsoft Azure AD. To update your name or
          email, please contact your administrator.
        </p>
      </div>
    </MainLayout>
  );
}
