import type { Metadata } from 'next';
import SessionProvider from '@/components/providers/SessionProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevDesk - Support Ticketing by KnowAll',
  description: 'Azure DevOps powered support ticketing system',
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
