'use client';

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

/** A quiet "Sign out" link that returns to the sign-in page. */
export default function SignOutLink() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-gray-400 underline-offset-4 transition-colors hover:text-white hover:underline"
    >
      <LogOut size={14} aria-hidden />
      Sign out
    </button>
  );
}
