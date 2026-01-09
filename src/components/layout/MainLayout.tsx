'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import Sidebar from './Sidebar';
import Header from './Header';
import NewTicketDialog from '@/components/tickets/NewTicketDialog';
import { useOrganization } from '@/components/providers/OrganizationProvider';

interface TicketCounts {
  yourActive: number;
  ratedLast7Days: number;
  unassigned: number;
  allActive: number;
  recentlyUpdated: number;
  createdToday: number;
  pending: number;
  recentlySolved: number;
}

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const { data: session } = useSession();
  const { selectedOrganization } = useOrganization();
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [ticketCounts, setTicketCounts] = useState<TicketCounts | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    // Don't fetch until we have both session and organization
    if (!session?.accessToken || !selectedOrganization?.accountName) return;

    const fetchTicketCounts = async () => {
      try {
        const response = await fetch('/api/devops/ticket-counts', {
          headers: {
            'x-devops-org': selectedOrganization.accountName,
          },
        });
        if (response.ok) {
          const counts = await response.json();
          setTicketCounts(counts);
        }
      } catch (error) {
        console.error('Failed to fetch ticket counts:', error);
      }
    };

    fetchTicketCounts();
  }, [session, selectedOrganization]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setSidebarOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
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
