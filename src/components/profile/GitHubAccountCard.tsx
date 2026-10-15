'use client';

import { useEffect, useState } from 'react';
import { Check, Github, Loader2, Save, Trash2 } from 'lucide-react';
import { useSourceFilter } from '@/components/providers/SourceProvider';

/**
 * The signed-in user's GitHub username, stored on their Microsoft profile
 * (#455). With it, GitHub issues assigned to or opened by that account are
 * listed under this person rather than under the GitHub username.
 *
 * Only shown when GitHub issues are configured: otherwise the username is not
 * used anywhere.
 */
export default function GitHubAccountCard() {
  const { gitHubConfigured } = useSourceFilter();

  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the saved username. Every state update waits for the response, and
  // one that arrives after the card is gone or reloading is dropped.
  useEffect(() => {
    if (!gitHubConfigured) return;
    let cancelled = false;

    (async () => {
      let loaded: string | null = null;
      let loadError: string | null = null;
      try {
        const response = await fetch('/api/profile/github');
        if (response.ok) {
          const data = (await response.json()) as { githubUsername?: string | null };
          loaded = data.githubUsername ?? null;
        } else if (response.status !== 401) {
          loadError = 'Failed to load GitHub username';
        }
      } catch {
        loadError = 'Failed to connect to server';
      }
      if (cancelled) return;
      setSavedUsername(loaded);
      setUsername(loaded ?? '');
      setError(loadError);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [gitHubConfigured]);

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/profile/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubUsername: username }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        githubUsername?: string;
        error?: string;
      };
      if (response.ok && data.githubUsername) {
        setSavedUsername(data.githubUsername);
        setUsername(data.githubUsername);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      } else {
        setError(data.error || 'Failed to save GitHub username');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/profile/github', { method: 'DELETE' });
      if (response.ok) {
        setSavedUsername(null);
        setUsername('');
      } else {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error || 'Failed to remove GitHub username');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsSaving(false);
    }
  };

  if (!gitHubConfigured) return null;

  const unchanged = username.trim() === (savedUsername ?? '');

  return (
    <div className="card mb-6 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Github size={20} style={{ color: 'var(--text-primary)' }} />
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          GitHub
        </h3>
      </div>
      <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Link your GitHub username so GitHub issues assigned to you or opened by you are listed under
        your name. This is stored in your Microsoft profile.
      </p>

      {error && (
        <div
          className="mb-4 rounded-md p-3 text-sm"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--priority-urgent)' }}
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="github-username"
          className="mb-1 block text-xs uppercase"
          style={{ color: 'var(--text-muted)' }}
        >
          GitHub Username
        </label>
        <div className="flex gap-2">
          {isLoading ? (
            <div className="input flex flex-1 items-center">
              <Loader2 className="animate-spin" size={16} style={{ color: 'var(--text-muted)' }} />
              <span className="ml-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                Loading...
              </span>
            </div>
          ) : (
            <input
              id="github-username"
              type="text"
              placeholder="your-github-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="input flex-1"
            />
          )}
          <button
            onClick={save}
            disabled={isSaving || isLoading || !username.trim() || unchanged}
            className="btn-primary flex items-center gap-2"
          >
            {justSaved ? (
              <>
                <Check size={16} />
                Saved
              </>
            ) : isSaving ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <>
                <Save size={16} />
                Save
              </>
            )}
          </button>
          {savedUsername && (
            <button
              onClick={remove}
              disabled={isSaving || isLoading}
              className="btn-secondary flex items-center gap-2"
              title="Unlink your GitHub username"
            >
              <Trash2 size={16} />
              Remove
            </button>
          )}
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Your username as it appears on github.com, without the @. The boards usually pick up a
          change at once, and always within ten minutes.
        </p>
      </div>
    </div>
  );
}
