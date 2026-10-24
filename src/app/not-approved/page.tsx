import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { notApprovedView } from '@/lib/tenant-approval';
import NotApprovedHero from '@/components/auth/NotApprovedHero';

export const metadata: Metadata = {
  title: 'Not set up yet - ZapDesk',
  robots: { index: false, follow: false },
};

/**
 * Shown to people whose organisation KnowAll has not approved (see
 * src/lib/tenant-approval.ts), and to admins who have just installed ZapDesk
 * for one (the "thanks for installing" variant).
 */
export default async function NotApprovedPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string; tenant?: string }>;
}) {
  const view = notApprovedView(await getServerSession(authOptions), await searchParams);
  if (view.redirect !== undefined) redirect(view.redirect);
  return <NotApprovedHero {...view} />;
}
