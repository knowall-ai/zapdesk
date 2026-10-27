import Link from 'next/link';
import { Mail } from 'lucide-react';
import ZapDeskIcon from '@/components/common/ZapDeskIcon';
import SignOutLink from '@/components/auth/SignOutLink';
import { ACCESS_REQUEST_EMAIL, accessRequestMailto } from '@/lib/tenant-approval';

export interface NotApprovedHeroProps {
  /** Signed in (show sign-out) or arriving straight from the install flow. */
  signedIn: boolean;
  /** The admin has just installed ZapDesk for this tenant. */
  installed: boolean;
  organisation: string | null;
  tenantId: string | null;
  email: string | null;
}

const APP = 'ZapDesk';

/**
 * "Your organisation isn't set up on ZapDesk yet": a half-bleed hero with the
 * ZapDesk product shot behind a dark gradient, and two ways to get in touch.
 * Deliberately has no navigation and loads no app data.
 */
export default function NotApprovedHero({
  signedIn,
  installed,
  organisation,
  tenantId,
  email,
}: NotApprovedHeroProps) {
  const mailto = accessRequestMailto({ app: APP, organisation, tenantId, email });

  return (
    <main className="relative isolate flex min-h-screen flex-col overflow-hidden bg-[#0a0a0f] text-white">
      {/* The big visual: ZapDesk's own product shot (from og-image.png), across the top on
          phones and as a large card bleeding off the right edge on desktop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-brand/15 absolute top-[18%] right-[-10%] hidden h-[60%] w-[70%] rounded-full blur-[120px] lg:block" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/not-approved-hero.png"
          alt=""
          className="absolute inset-x-0 top-20 h-[44vh] w-full object-cover object-top-left opacity-80 lg:inset-x-auto lg:top-1/2 lg:left-[43%] lg:h-auto lg:w-[82vw] lg:max-w-none lg:-translate-y-1/2 lg:rounded-2xl lg:object-contain lg:opacity-100 lg:shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] lg:ring-1 lg:ring-white/10"
        />
        {/* Dark gradient behind the text: up from the bottom on phones, in from the left on desktop */}
        <div className="absolute inset-x-0 top-20 h-[44vh] bg-[linear-gradient(to_bottom,#0a0a0f_0%,rgba(10,10,15,0.35)_22%,rgba(10,10,15,0.45)_55%,#0a0a0f_100%)] lg:hidden" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-[#0a0a0f] from-40% via-[#0a0a0f]/60 via-55% to-transparent to-75% lg:block" />
      </div>

      <header className="px-6 pt-6 lg:px-16 lg:pt-10">
        <div className="flex items-center gap-2.5">
          <ZapDeskIcon size={32} />
          <span className="text-lg font-semibold tracking-tight">
            <span className="text-brand">Zap</span>Desk
          </span>
        </div>
      </header>

      <section className="flex flex-1 items-end px-6 pt-[40vh] pb-12 lg:items-center lg:px-16 lg:pt-0 lg:pb-16">
        <div className="max-w-xl">
          <p className="border-brand/40 bg-brand/10 text-brand-hover mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tracking-wide uppercase">
            Awaiting approval
          </p>
          <h1 className="text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Your organisation isn&apos;t set up on {APP} yet.
          </h1>
          <p className="mt-5 max-w-lg text-base text-gray-300 sm:text-lg">
            {installed
              ? 'Thanks for installing ZapDesk. KnowAll approves each organisation before its people can sign in, so drop us a line and we will switch you on.'
              : 'ZapDesk is open to organisations KnowAll has approved. Get in touch and we’ll set yours up.'}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <a
              href={mailto}
              className="btn-primary shadow-brand/20 inline-flex items-center gap-2 px-6! py-3! text-base shadow-lg"
            >
              <Mail size={18} aria-hidden />
              Request access
            </a>
            <p className="text-sm text-gray-300">
              Or email us at{' '}
              <a
                href={`mailto:${ACCESS_REQUEST_EMAIL}`}
                className="hover:text-brand-hover font-semibold text-white underline underline-offset-4"
              >
                {ACCESS_REQUEST_EMAIL}
              </a>
            </p>
          </div>

          <dl className="mt-10 space-y-1 text-xs text-gray-500">
            {organisation && (
              <div className="flex flex-wrap gap-x-2">
                <dt>Organisation</dt>
                <dd className="text-gray-400">{organisation}</dd>
              </div>
            )}
            {tenantId && (
              <div className="flex flex-wrap gap-x-2">
                <dt>Tenant ID</dt>
                <dd className="font-mono break-all text-gray-400">{tenantId}</dd>
              </div>
            )}
            {email && (
              <div className="flex flex-wrap gap-x-2">
                <dt>Signed in as</dt>
                <dd className="break-all text-gray-400">{email}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6">
            {signedIn ? (
              <SignOutLink />
            ) : (
              <Link
                href="/login"
                className="text-sm text-gray-400 underline-offset-4 hover:text-white hover:underline"
              >
                Back to sign in
              </Link>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
