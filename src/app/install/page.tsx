import Link from 'next/link';
import { CheckCircle, AlertTriangle, Building2 } from 'lucide-react';
import { isMultiTenant } from '@/lib/auth';

/**
 * Install ZapDesk for an organisation (#457).
 *
 * An admin of a Microsoft Entra tenant grants ZapDesk's permissions once, on
 * Microsoft's consent page, and their people can then sign in. The outcome of
 * that page comes back here as `?result=`.
 */

type Result = 'installed' | 'declined' | 'state' | 'failed' | 'unavailable';

const MESSAGES: Record<Exclude<Result, 'installed'>, { title: string; body: string }> = {
  declined: {
    title: 'ZapDesk was not installed',
    body: 'The permissions were not granted. You can start again whenever you are ready.',
  },
  state: {
    title: 'That install link has expired',
    body: 'The request did not come from this browser, or took longer than ten minutes. Start again from this page.',
  },
  failed: {
    title: 'ZapDesk could not be installed',
    body: 'Microsoft did not confirm the install. Make sure you are signed in as an administrator of your organisation (Global Administrator, Privileged Role Administrator or Cloud Application Administrator), then try again.',
  },
  unavailable: {
    title: 'This ZapDesk serves one organisation',
    body: 'It is not set up for other organisations to install. Ask whoever runs it, or run your own copy of ZapDesk: it is open source.',
  },
};

const RESULTS = new Set<Result>(['installed', 'declined', 'state', 'failed', 'unavailable']);

export default async function InstallPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; detail?: string }>;
}) {
  const params = await searchParams;
  const result = RESULTS.has(params.result as Result) ? (params.result as Result) : null;
  const shown: Result | null = result ?? (isMultiTenant() ? null : 'unavailable');
  // Only an Entra error code is passed through, never free text from the URL
  const detail = /^(AADSTS\d+|[a-z_]+)$/.test(params.detail || '') ? params.detail : undefined;

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <div className="card w-full max-w-lg p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <span className="text-3xl font-bold text-white">⚡</span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Install ZapDesk for your organisation
          </h1>
        </div>

        {shown === 'installed' ? (
          <div className="text-center">
            <CheckCircle
              size={40}
              className="mx-auto mb-3"
              style={{ color: 'var(--primary)' }}
              aria-hidden
            />
            <h2 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              ZapDesk is installed
            </h2>
            <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
              People in your organisation can now sign in with their Microsoft account. They will
              see the Azure DevOps organisations and projects they already have access to.
            </p>
            <Link href="/login" className="btn-primary inline-flex items-center gap-2">
              Sign in
            </Link>
          </div>
        ) : shown ? (
          <div className="text-center">
            <AlertTriangle
              size={40}
              className="mx-auto mb-3"
              style={{ color: 'var(--priority-high)' }}
              aria-hidden
            />
            <h2 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {MESSAGES[shown].title}
            </h2>
            <p className="mb-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {MESSAGES[shown].body}
            </p>
            {detail && (
              <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                Microsoft error: <code>{detail}</code>
              </p>
            )}
            {shown !== 'unavailable' && (
              <a href="/api/install" className="btn-primary mt-4 inline-flex items-center gap-2">
                <Building2 size={16} />
                Try again
              </a>
            )}
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              You need to be an administrator of your Microsoft Entra organisation. Installing adds
              ZapDesk to your organisation&apos;s enterprise applications, so your people can sign
              in. Nothing is copied out of your organisation: tickets stay in your Azure DevOps, and
              personal settings stay on each person&apos;s Microsoft profile.
            </p>
            <ul
              className="mb-6 list-disc space-y-1 pl-5 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <li>
                Microsoft shows you the permissions ZapDesk asks for before anything is granted.
              </li>
              <li>
                You can remove ZapDesk at any time under Enterprise applications in the Entra admin
                center.
              </li>
              <li>Each person still only sees the Azure DevOps projects they have access to.</li>
            </ul>
            <a
              href="/api/install"
              className="btn-primary flex w-full items-center justify-center gap-2"
            >
              <Building2 size={16} />
              Install for my organisation
            </a>
            <p className="mt-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Already installed?{' '}
              <Link href="/login" style={{ color: 'var(--primary)' }}>
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
