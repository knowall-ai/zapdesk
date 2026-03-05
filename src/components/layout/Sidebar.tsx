'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Home,
  Ticket,
  Users,
  Users2,
  Building2,
  Activity,
  Settings,
  Plus,
  RefreshCw,
  Inbox,
  Clock,
  UserCheck,
  AlertCircle,
  CheckCircle,
  CalendarCheck,
  PlusCircle,
  X,
} from 'lucide-react';
import ZapDeskIcon from '@/components/common/ZapDeskIcon';

interface ViewItem {
  id: string;
  name: string;
  icon: React.ReactNode;
  href: string;
  count?: number;
}

const mainNavItems = [
  { id: 'home', name: 'Home', icon: <Home size={20} />, href: '/' },
  { id: 'tickets', name: 'Tickets', icon: <Ticket size={20} />, href: '/tickets' },
  { id: 'users', name: 'Users', icon: <Users size={20} />, href: '/users' },
  {
    id: 'projects',
    name: 'Projects',
    icon: <Building2 size={20} />,
    href: '/projects',
  },
  { id: 'team', name: 'Team', icon: <Users2 size={20} />, href: '/team' },
  {
    id: 'live-dashboard',
    name: 'Live Dashboard',
    icon: <Activity size={20} />,
    href: '/reporting',
  },
  {
    id: 'monthly-checkpoint',
    name: 'Monthly Checkpoint',
    icon: <CalendarCheck size={20} />,
    href: '/monthly-checkpoint',
  },
  { id: 'admin', name: 'Admin', icon: <Settings size={20} />, href: '/admin' },
];

interface SidebarProps {
  ticketCounts?: {
    yourActive: number;
    unassigned: number;
    allActive: number;
    recentlyUpdated: number;
    pending: number;
    recentlySolved: number;
    createdToday: number;
  };
  onNewTicket?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({
  ticketCounts,
  onNewTicket,
  isOpen = false,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const counts = ticketCounts || {
    yourActive: 0,
    unassigned: 0,
    allActive: 0,
    recentlyUpdated: 0,
    pending: 0,
    recentlySolved: 0,
    createdToday: 0,
  };

  const viewItems: ViewItem[] = [
    {
      id: 'your-active',
      name: 'Your active tickets',
      icon: <Inbox size={16} />,
      href: '/tickets?view=your-active',
      count: counts.yourActive,
    },
    {
      id: 'unassigned',
      name: 'Unassigned tickets',
      icon: <UserCheck size={16} />,
      href: '/tickets?view=unassigned',
      count: counts.unassigned,
    },
    {
      id: 'all-active',
      name: 'All active tickets',
      icon: <AlertCircle size={16} />,
      href: '/tickets?view=all-active',
      count: counts.allActive,
    },
    {
      id: 'recently-updated',
      name: 'Recently updated tickets',
      icon: <Clock size={16} />,
      href: '/tickets?view=recently-updated',
      count: counts.recentlyUpdated,
    },
    {
      id: 'created-today',
      name: 'Created today',
      icon: <PlusCircle size={16} />,
      href: '/tickets?view=created-today',
      count: counts.createdToday,
    },
    {
      id: 'pending',
      name: 'Pending tickets',
      icon: <Clock size={16} />,
      href: '/tickets?view=pending',
      count: counts.pending,
    },
    {
      id: 'recently-solved',
      name: 'Recently solved tickets',
      icon: <CheckCircle size={16} />,
      href: '/tickets?view=recently-solved',
      count: counts.recentlySolved,
    },
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 transform flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      {/* Logo with mobile close button */}
      <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" onClick={() => onClose?.()}>
            <ZapDeskIcon size={32} />
            <span className="text-xl font-semibold" style={{ color: 'var(--primary)' }}>
              ZapDesk
            </span>
          </Link>
          <button
            onClick={() => onClose?.()}
            className="rounded-md p-1 transition-colors hover:bg-[var(--surface-hover)] md:hidden"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Add button */}
      <div className="border-b p-3" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => {
            onNewTicket?.();
            onClose?.();
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <Plus size={16} />
          Add
        </button>
      </div>

      {/* Main navigation */}
      <nav className="py-2">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

          return (
            <Link
              key={item.id}
              href={item.href}
              className={`nav-item mx-2 ${isActive ? 'active' : ''}`}
              onClick={() => onClose?.()}
            >
              {item.icon}
              <span className="text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Views section */}
      <div className="flex-1 overflow-y-auto border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              Views
            </span>
            <div className="flex items-center gap-1">
              <button className="rounded p-1 hover:bg-[var(--surface-hover)]">
                <Plus size={14} style={{ color: 'var(--text-muted)' }} />
              </button>
              <button className="rounded p-1 hover:bg-[var(--surface-hover)]">
                <RefreshCw size={14} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          </div>

          <div className="space-y-1">
            {viewItems.map((view) => {
              const currentSearch = searchParams.toString();
              const currentUrl = pathname + (currentSearch ? `?${currentSearch}` : '');
              const isActive = currentUrl === view.href;
              return (
                <Link
                  key={view.id}
                  href={view.href}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-[rgba(34,197,94,0.15)] text-[var(--primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                  onClick={() => onClose?.()}
                >
                  <span className="truncate">{view.name}</span>
                  {view.count !== undefined && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        isActive
                          ? 'bg-[var(--primary)] text-white'
                          : view.count > 0
                            ? 'bg-[rgba(34,197,94,0.15)] text-[var(--primary)]'
                            : 'bg-[var(--surface)] text-[var(--text-muted)]'
                      }`}
                    >
                      {view.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Bottom section */}
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <Link
            href="/tickets?view=removed"
            className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            onClick={() => onClose?.()}
          >
            <span>Removed tickets</span>
            <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs">0</span>
          </Link>
        </div>
      </div>

      {/* Branding footer */}
      <div className="border-t p-3 text-center" style={{ borderColor: 'var(--border)' }}>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <div>v{process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'}</div>
          <div className="mt-1">
            Built by{' '}
            <a
              href="https://knowall.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--primary)]"
              aria-label="KnowAll AI (opens in new tab)"
            >
              KnowAll AI
            </a>
          </div>
          <div className="mt-0.5">Powered by Bitcoin Lightning ⚡</div>
        </div>
      </div>
    </aside>
  );
}
