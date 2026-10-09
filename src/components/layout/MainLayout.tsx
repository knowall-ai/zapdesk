'use client';

import { useState, useSyncExternalStore, Suspense } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import NewTicketDialog from '@/components/tickets/NewTicketDialog';
import { useTicketCounts } from '@/components/providers/TicketCountsProvider';

// Whether the desktop sidebar is collapsed to its icon rail (#410), kept in
// localStorage so it survives navigation and reloads. Read through
// useSyncExternalStore: the server snapshot is "expanded", so hydration matches,
// and other tabs follow along through the `storage` event.
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'zapdesk:sidebar:collapsed';
const SIDEBAR_COLLAPSED_EVENT = 'zapdesk:sidebar-collapsed-change';
// Fallback for when localStorage throws (private/sandboxed contexts), so the
// toggle still works for the session.
let sidebarCollapsedInMemory = false;

function subscribeSidebarCollapsed(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, onChange);
  };
}

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return sidebarCollapsedInMemory;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  sidebarCollapsedInMemory = collapsed;
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Not persisted; the in-memory value carries it for this session
  }
  // `storage` only fires in *other* tabs, so tell this one directly.
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT));
}

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarCollapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    readSidebarCollapsed,
    () => false
  );
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
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => writeSidebarCollapsed(!sidebarCollapsed)}
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
