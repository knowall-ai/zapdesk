'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import NewTicketDialog from '@/components/tickets/NewTicketDialog';

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
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar ticketCounts={ticketCounts} onNewTicket={() => setIsNewTicketOpen(true)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--background)' }}>
          {children}
        </main>
      </div>
      <NewTicketDialog isOpen={isNewTicketOpen} onClose={() => setIsNewTicketOpen(false)} />
    </div>
  );
}
