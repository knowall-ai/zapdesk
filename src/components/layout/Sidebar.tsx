'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Ticket,
  Users,
  Building2,
  BarChart3,
  Settings,
  Plus,
  RefreshCw,
  ChevronDown,
  Inbox,
  Clock,
  UserCheck,
  AlertCircle,
  CheckCircle,
  Star,
} from 'lucide-react';

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
  { id: 'customers', name: 'Customers', icon: <Users size={20} />, href: '/customers' },
  {
    id: 'organizations',
    name: 'Organizations',
    icon: <Building2 size={20} />,
    href: '/organizations',
  },
  { id: 'reporting', name: 'Reporting', icon: <BarChart3 size={20} />, href: '/reporting' },
  { id: 'admin', name: 'Admin', icon: <Settings size={20} />, href: '/admin' },
];

interface SidebarProps {
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

export default function Sidebar({ ticketCounts }: SidebarProps) {
  const pathname = usePathname();

  const counts = ticketCounts || {
    yourUnsolved: 0,
    ratedLast7Days: 0,
    unassigned: 0,
    allUnsolved: 0,
    recentlyUpdated: 0,
    newInGroups: 0,
    pending: 0,
    recentlySolved: 0,
    unsolvedInGroups: 0,
  };

  const viewItems: ViewItem[] = [
    {
      id: 'your-unsolved',
      name: 'Your unsolved tickets',
      icon: <Inbox size={16} />,
      href: '/tickets?view=your-unsolved',
      count: counts.yourUnsolved,
    },
    {
      id: 'rated-7days',
      name: 'Rated tickets from the last 7 days',
      icon: <Star size={16} />,
      href: '/tickets?view=rated',
      count: counts.ratedLast7Days,
    },
    {
      id: 'unassigned',
      name: 'Unassigned tickets',
      icon: <UserCheck size={16} />,
      href: '/tickets?view=unassigned',
      count: counts.unassigned,
    },
    {
      id: 'all-unsolved',
      name: 'All unsolved tickets',
      icon: <AlertCircle size={16} />,
      href: '/tickets?view=all-unsolved',
      count: counts.allUnsolved,
    },
    {
      id: 'recently-updated',
      name: 'Recently updated tickets',
      icon: <Clock size={16} />,
      href: '/tickets?view=recently-updated',
      count: counts.recentlyUpdated,
    },
    {
      id: 'new-in-groups',
      name: 'New tickets in your groups',
      icon: <Inbox size={16} />,
      href: '/tickets?view=new-in-groups',
      count: counts.newInGroups,
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
    {
      id: 'unsolved-in-groups',
      name: 'Unsolved tickets in your groups',
      icon: <AlertCircle size={16} />,
      href: '/tickets?view=unsolved-in-groups',
      count: counts.unsolvedInGroups,
    },
  ];

  return (
    <aside className="flex h-screen w-64 flex-col" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
      {/* Logo */}
      <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
        <Link href="/" className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <span className="text-lg font-bold text-white">D</span>
          </div>
          <span className="text-xl font-semibold" style={{ color: 'var(--primary)' }}>
            DevDesk
          </span>
        </Link>
      </div>

      {/* Add button */}
      <div className="border-b p-3" style={{ borderColor: 'var(--border)' }}>
        <Link
          href="/tickets/new"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Plus size={16} />
          Add
        </Link>
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
              const isActive =
                pathname + (typeof window !== 'undefined' ? window.location.search : '') ===
                view.href;
              return (
                <Link
                  key={view.id}
                  href={view.href}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-[rgba(34,197,94,0.15)] text-[var(--primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className="truncate">{view.name}</span>
                  {view.count !== undefined && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        isActive
                          ? 'bg-[var(--primary)] text-white'
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
            href="/tickets?view=suspended"
            className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            <span>Suspended tickets</span>
            <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs">0</span>
          </Link>
          <Link
            href="/tickets?view=deleted"
            className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            <span>Deleted tickets</span>
            <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs">0</span>
          </Link>
          <Link
            href="/admin/views"
            className="flex items-center gap-1 rounded px-2 py-1.5 text-sm text-[var(--primary)] hover:bg-[var(--surface-hover)]"
          >
            Manage views
            <ChevronDown size={14} className="rotate-[-90deg]" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
