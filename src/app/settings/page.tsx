'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { Settings, Bell, Globe, Layout, Save, Check } from 'lucide-react';

interface UserSettings {
  notifications: {
    desktop: boolean;
    emailTicketUpdates: boolean;
    emailMentions: boolean;
    emailAssignments: boolean;
  };
  timezone: string;
  defaultTicketView: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  notifications: {
    desktop: true,
    emailTicketUpdates: true,
    emailMentions: true,
    emailAssignments: true,
  },
  timezone:
    typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
  defaultTicketView: 'all-unsolved',
};

const BASE_TIMEZONE_OPTIONS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function getTimezoneOptions(): string[] {
  if (typeof window === 'undefined') return BASE_TIMEZONE_OPTIONS;
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (BASE_TIMEZONE_OPTIONS.includes(detected)) return BASE_TIMEZONE_OPTIONS;
  return [detected, ...BASE_TIMEZONE_OPTIONS];
}

const VIEW_OPTIONS = [
  { value: 'your-unsolved', label: 'Your unsolved tickets' },
  { value: 'all-unsolved', label: 'All unsolved tickets' },
  { value: 'unassigned', label: 'Unassigned tickets' },
  { value: 'recently-updated', label: 'Recently updated tickets' },
  { value: 'pending', label: 'Pending tickets' },
];

function getInitialSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem('devdesk-settings');
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<UserSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        notifications: {
          ...DEFAULT_SETTINGS.notifications,
          ...(parsed.notifications || {}),
        },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: UserSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('devdesk-settings', JSON.stringify(settings));
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings>(() => getInitialSettings());
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const handleNotificationChange = (key: keyof UserSettings['notifications']) => {
    setSettings((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [key]: !prev.notifications[key],
      },
    }));
    setSaveSuccess(false);
  };

  const handleTimezoneChange = (timezone: string) => {
    setSettings((prev) => ({ ...prev, timezone }));
    setSaveSuccess(false);
  };

  const handleViewChange = (defaultTicketView: string) => {
    setSettings((prev) => ({ ...prev, defaultTicketView }));
    setSaveSuccess(false);
  };

  const handleSave = () => {
    saveSettings(settings);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
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
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings size={24} style={{ color: 'var(--primary)' }} />
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Settings
            </h1>
          </div>
          <button onClick={handleSave} className="btn-primary flex items-center gap-2">
            {saveSuccess ? (
              <>
                <Check size={18} />
                Saved
              </>
            ) : (
              <>
                <Save size={18} />
                Save Changes
              </>
            )}
          </button>
        </div>

        <div className="space-y-6">
          {/* Notifications Section */}
          <section
            className="card p-6"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <Bell size={20} style={{ color: 'var(--primary)' }} />
              <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                Notifications
              </h2>
            </div>

            <div className="space-y-4">
              <ToggleOption
                label="Desktop notifications"
                description="Show desktop notifications for new tickets and updates"
                checked={settings.notifications.desktop}
                onChange={() => handleNotificationChange('desktop')}
              />
              <ToggleOption
                label="Email on ticket updates"
                description="Receive email when tickets you're watching are updated"
                checked={settings.notifications.emailTicketUpdates}
                onChange={() => handleNotificationChange('emailTicketUpdates')}
              />
              <ToggleOption
                label="Email on mentions"
                description="Receive email when someone mentions you in a comment"
                checked={settings.notifications.emailMentions}
                onChange={() => handleNotificationChange('emailMentions')}
              />
              <ToggleOption
                label="Email on assignments"
                description="Receive email when a ticket is assigned to you"
                checked={settings.notifications.emailAssignments}
                onChange={() => handleNotificationChange('emailAssignments')}
              />
            </div>
          </section>

          {/* Timezone Section */}
          <section
            className="card p-6"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <Globe size={20} style={{ color: 'var(--primary)' }} />
              <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                Timezone
              </h2>
            </div>

            <div>
              <label
                className="mb-2 block text-sm"
                style={{ color: 'var(--text-secondary)' }}
                htmlFor="timezone-select"
              >
                Display times in your local timezone
              </label>
              <select
                id="timezone-select"
                value={settings.timezone}
                onChange={(e) => handleTimezoneChange(e.target.value)}
                className="input w-full max-w-md"
              >
                {getTimezoneOptions().map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Default View Section */}
          <section
            className="card p-6"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <Layout size={20} style={{ color: 'var(--primary)' }} />
              <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                Default Ticket View
              </h2>
            </div>

            <div>
              <label
                className="mb-2 block text-sm"
                style={{ color: 'var(--text-secondary)' }}
                htmlFor="view-select"
              >
                Choose which view to show by default when opening tickets
              </label>
              <select
                id="view-select"
                value={settings.defaultTicketView}
                onChange={(e) => handleViewChange(e.target.value)}
                className="input w-full max-w-md"
              >
                {VIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>
      </div>
    </MainLayout>
  );
}

interface ToggleOptionProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

const TOGGLE_OFFSET = 20; // width(44px) - toggle(20px) - padding(4px)

function ToggleOption({ label, description, checked, onChange }: ToggleOptionProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {label}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      </div>
      <button
        onClick={onChange}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            onChange();
          }
        }}
        className="relative h-6 w-11 rounded-full transition-colors"
        style={{
          backgroundColor: checked ? 'var(--primary)' : 'var(--border)',
        }}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          style={{
            transform: checked ? `translateX(${TOGGLE_OFFSET}px)` : 'translateX(0)',
          }}
        />
      </button>
    </div>
  );
}
