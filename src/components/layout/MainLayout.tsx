'use client';

import Sidebar from './Sidebar';
import Header from './Header';

interface MainLayoutProps {
  children: React.ReactNode;
  ticketCounts?: {
    yourUnsolved: number;
    ratedLast7Days: number;
    unassigned: number;
    allUnsolved: number;
    recentlyUpdated: number;
    newInGroups: number;
    pending: number;
    recentlySolved: number;
    unsolvedInGroups: number;
  };
}

export default function MainLayout({ children, ticketCounts }: MainLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar ticketCounts={ticketCounts} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--background)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
