'use client';

import { ShieldX } from 'lucide-react';
import Link from 'next/link';

interface AccessDeniedProps {
  message?: string;
}

export default function AccessDenied({
  message = 'You do not have permission to access this page.',
}: AccessDeniedProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <ShieldX size={48} style={{ color: 'var(--text-muted)' }} />
      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        Access Denied
      </h2>
      <p className="max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
      <Link href="/" className="btn-primary mt-2 text-sm">
        Go to Home
      </Link>
    </div>
  );
}
