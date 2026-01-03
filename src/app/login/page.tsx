'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session) {
      router.push('/');
    }
  }, [session, router]);

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--background)' }}
      >
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <div className="card w-full max-w-md p-8">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <span className="text-3xl font-bold text-white">D</span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>
            DevDesk
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            by KnowAll
          </p>
        </div>

        {/* Title */}
        <div className="mb-8 text-center">
          <h2 className="mb-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Welcome back
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Sign in with your Microsoft account to access your support tickets
          </p>
        </div>

        {/* Sign in button */}
        <button
          onClick={() => signIn('azure-ad', { callbackUrl: '/' })}
          className="flex w-full items-center justify-center gap-3 rounded-lg px-4 py-3 font-medium transition-colors"
          style={{
            backgroundColor: 'var(--surface-hover)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </button>

        {/* Info */}
        <div className="mt-8 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            DevDesk connects to Azure DevOps to display work items tagged as tickets. You&apos;ll
            only see tickets from projects you have access to.
          </p>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Need help?{' '}
            <a
              href="mailto:support@knowall.ai"
              className="hover:underline"
              style={{ color: 'var(--primary)' }}
            >
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
