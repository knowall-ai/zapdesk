'use client';

import { useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Search,
  MessageSquare,
  Bell,
  ChevronDown,
  LogOut,
  User,
  Settings,
} from 'lucide-react';
import { Avatar } from '@/components/common';

export default function Header() {
  const { data: session } = useSession();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <header
      className="flex h-14 items-center justify-between border-b px-4"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Search */}
      <div className="flex max-w-xl flex-1 items-center">
        <div className="relative w-full">
          <Search
            size={18}
            className="absolute top-1/2 left-3 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            placeholder="Search tickets, customers, organizations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input w-full py-2 pr-4 pl-10 text-sm"
          />
        </div>
      </div>

      {/* Right side actions */}
      <div className="ml-4 flex items-center gap-2">
        {/* Conversations */}
        <button
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors"
          style={{
            color: 'var(--text-secondary)',
            backgroundColor: 'transparent',
          }}
        >
          <MessageSquare size={18} />
          <span>Conversations</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-xs"
            style={{ backgroundColor: 'var(--primary)', color: 'white' }}
          >
            0
          </span>
        </button>

        {/* Notifications */}
        <button
          className="rounded-md p-2 transition-colors hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Bell size={20} />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Avatar
              name={session?.user?.name || 'User'}
              image={session?.user?.image ?? undefined}
              size="sm"
            />
            <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
              <div
                className="absolute top-full right-0 z-20 mt-1 w-64 rounded-lg py-2 shadow-lg"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {session?.user?.name || 'User'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {session?.user?.email || ''}
                  </p>
                </div>

                <div className="py-1">
                  <Link
                    href="/profile"
                    className="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--text-secondary)' }}
                    onClick={() => setShowUserMenu(false)}
                  >
                    <User size={16} />
                    Profile
                  </Link>
                  <Link
                    href="/settings"
                    className="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--text-secondary)' }}
                    onClick={() => setShowUserMenu(false)}
                  >
                    <Settings size={16} />
                    Settings
                  </Link>
                </div>

                <div className="border-t py-1" style={{ borderColor: 'var(--border)' }}>
                  <button
                    onClick={() => signOut({ callbackUrl: '/login' })}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--priority-urgent)' }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
