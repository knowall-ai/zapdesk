import type { Metadata } from 'next';
import SessionProvider from '@/components/providers/SessionProvider';
import './globals.css';

const siteUrl = process.env.NEXTAUTH_URL || 'https://devdesk.knowall.ai';

export const metadata: Metadata = {
  title: 'DevDesk - Support Ticketing by KnowAll',
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
    siteName: 'DevDesk',
    title: 'DevDesk - Support Ticketing by KnowAll',
    description:
      'A modern support ticketing portal powered by Azure DevOps. Manage tickets, track issues, and deliver exceptional customer support.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'DevDesk - Support Ticketing Dashboard',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DevDesk - Support Ticketing by KnowAll',
    description:
      'A modern support ticketing portal powered by Azure DevOps. Manage tickets, track issues, and deliver exceptional customer support.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'msapplication-TileColor': '#22c55e',
    'theme-color': '#0f1117',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
