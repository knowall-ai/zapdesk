'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Github, Loader2, Unplug } from 'lucide-react';

/**
 * Connect a DevOps project to GitHub through the ZapDesk GitHub App (#457).
 *
 * Shown only when the App is set up on this server. Anyone sees what is
 * connected; only someone who may edit the project gets Connect / Disconnect.
 */

interface ConnectionState {
  app: boolean;
  connection: { installationId: number; account: string } | null;
  canManage: boolean;
}

/** Outcomes of the GitHub round trip, passed back as ?github=. */
const RESULT_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'GitHub is connected. Its issues now show with this project.', ok: true },
  requested: {
    text: 'Your GitHub organisation owner has been asked to approve ZapDesk. Connect again once they have.',
    ok: true,
  },
  forbidden: {
    text: 'GitHub was not connected: you need to be able to edit this project in Azure DevOps, and to see the installation on GitHub.',
    ok: false,
  },
  expired: { text: 'That GitHub link has expired. Click Connect GitHub again.', ok: false },
  failed: { text: 'GitHub could not be connected. Please try again.', ok: false },
  unavailable: { text: 'GitHub connections are not set up on this ZapDesk.', ok: false },
};

/** How long to wait for the connection before giving up. */
const LOAD_TIMEOUT_MS = 15_000;

export default function GitHubConnectionCard({
  org,
  projectId,
}: {
  org: string;
  projectId: string;
}) {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The outcome of a Connect round trip, then drop it from the address bar
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('github');
    if (!outcome) return;
    url.searchParams.delete('github');
    window.history.replaceState(null, '', url.toString());
    const message = RESULT_MESSAGES[outcome];
    if (message) queueMicrotask(() => setResult(message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);

    (async () => {
      let loaded: ConnectionState | null = null;
      let loadError: string | null = null;
      try {
        const response = await fetch(
          `/api/github/connection?project=${encodeURIComponent(projectId)}`,
          { headers: { 'x-devops-org': org }, signal: controller.signal }
        );
        if (response.ok) loaded = (await response.json()) as ConnectionState;
        else loadError = 'Could not load the GitHub connection';
      } catch {
        loadError = 'Could not load the GitHub connection';
      } finally {
        clearTimeout(timeout);
      }
      if (cancelled) return;
      setState(loaded);
      setError(loadError);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [org, projectId, reloadKey]);

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/github/connection?project=${encodeURIComponent(projectId)}`,
        { method: 'DELETE', headers: { 'x-devops-org': org } }
      );
      if (response.ok) {
        setResult(null);
        setReloadKey((key) => key + 1);
      } else {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error || 'Could not disconnect GitHub');
      }
    } catch {
      setError('Could not disconnect GitHub');
    } finally {
      setBusy(false);
    }
  };

  // Nothing to offer when the App is not set up here
  if (!loading && !error && !state?.app) return null;

  const connectHref = `/api/github/connect?org=${encodeURIComponent(org)}&project=${encodeURIComponent(projectId)}`;
  const connection = state?.connection;

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Github size={18} style={{ color: 'var(--text-primary)' }} />
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          GitHub
        </h2>
      </div>

      {result && (
        <div
          className="mb-4 rounded-md p-3 text-sm"
          style={{
            backgroundColor: result.ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: result.ok ? 'var(--primary)' : 'var(--priority-urgent)',
          }}
        >
          {result.text}
        </div>
      )}
      {error && (
        <div
          className="mb-4 rounded-md p-3 text-sm"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--priority-urgent)' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <Loader2 className="animate-spin" size={18} style={{ color: 'var(--text-muted)' }} />
      ) : connection ? (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Issues from{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {connection.account || 'GitHub'}
            </strong>{' '}
            show beside this project&apos;s work items.
          </p>
          <div className="flex flex-wrap gap-2">
            {connection.account && (
              <a
                href={`https://github.com/organizations/${encodeURIComponent(connection.account)}/settings/installations`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                Choose repositories on GitHub <ExternalLink size={14} />
              </a>
            )}
            {state?.canManage && (
              <button
                onClick={disconnect}
                disabled={busy}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Unplug size={14} />}
                Disconnect
              </button>
            )}
          </div>
        </div>
      ) : state?.canManage ? (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Show this project&apos;s GitHub issues beside its work items. You will install the
            ZapDesk GitHub App on your GitHub organisation and pick the repositories it may read.
          </p>
          <a href={connectHref} className="btn-primary inline-flex items-center gap-2 text-sm">
            <Github size={16} />
            Connect GitHub
          </a>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Not connected. Someone who can edit this project in Azure DevOps can connect GitHub here.
        </p>
      )}
    </div>
  );
}
