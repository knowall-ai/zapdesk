import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Toaster } from 'sonner';
import SessionProvider from '@/components/providers/SessionProvider';
import OrganizationProvider from '@/components/providers/OrganizationProvider';
import TicketCountsProvider from '@/components/providers/TicketCountsProvider';
import SourceProvider from '@/components/providers/SourceProvider';
import './globals.css';
import { BRAND_COLORS } from '@/lib/brand';

const siteUrl = process.env.NEXTAUTH_URL || 'https://zapdesk.knowall.ai';

// The query changes whenever the image does: sharing sites cache previews by
// URL, and kept showing the old DevDesk card after the rebrand (#480).
const OG_IMAGE = '/og-image.png?v=2';

export const metadata: Metadata = {
  title: 'ZapDesk - Support Ticketing by KnowAll',
  description:
    'A modern support ticketing portal powered by Azure DevOps. Manage tickets, track issues, and deliver exceptional customer support.',
  keywords: [
    'support ticketing',
    'help desk',
    'Azure DevOps',
    'customer support',
    'ticket management',
    'issue tracking',
  ],
  authors: [{ name: 'KnowAll AI', url: 'https://knowall.ai' }],
  creator: 'KnowAll AI',
  publisher: 'KnowAll AI',
  metadataBase: new URL(siteUrl),
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'ZapDesk',
    title: 'ZapDesk - Support Ticketing by KnowAll',
    description:
      'A modern support ticketing portal powered by Azure DevOps. Manage tickets, track issues, and deliver exceptional customer support.',
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'ZapDesk - Support Ticketing Dashboard',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZapDesk - Support Ticketing by KnowAll',
    description:
      'A modern support ticketing portal powered by Azure DevOps. Manage tickets, track issues, and deliver exceptional customer support.',
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'msapplication-TileColor': BRAND_COLORS.brand,
    'theme-color': '#0f1117',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Render per request so Next can stamp each page's scripts with the CSP
  // nonce from src/proxy.ts; a prerendered page would carry no nonce.
  await connection();

  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <SessionProvider>
          <OrganizationProvider>
            <SourceProvider>
              <TicketCountsProvider>{children}</TicketCountsProvider>
            </SourceProvider>
          </OrganizationProvider>
        </SessionProvider>
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
