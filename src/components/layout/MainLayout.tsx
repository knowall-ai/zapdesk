'use client';

import { useState, Suspense } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import NewTicketDialog from '@/components/tickets/NewTicketDialog';
import { useTicketCounts } from '@/components/providers/TicketCountsProvider';

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Fetching and invalidation live in the provider so any mutation, anywhere
  // in the tree, can keep these numbers honest (issue #404).
  const { counts: ticketCounts } = useTicketCounts();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <Suspense
        fallback={<div className="w-60 shrink-0" style={{ backgroundColor: 'var(--sidebar)' }} />}
      >
        <Sidebar
          ticketCounts={ticketCounts}
          onNewTicket={() => setIsNewTicketOpen(true)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      </Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--background)' }}>
          {children}
        </main>
      </div>
      <NewTicketDialog isOpen={isNewTicketOpen} onClose={() => setIsNewTicketOpen(false)} />
    </div>
  );
}
