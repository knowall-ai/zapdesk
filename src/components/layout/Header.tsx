'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  Bell,
  ChevronDown,
  LogOut,
  User,
  Settings,
  Ticket,
  Building2,
  Users,
  Loader2,
  Menu,
} from 'lucide-react';
import { Avatar } from '@/components/common';
import { useProfilePhoto } from '@/hooks';
import OrganizationSwitcher from './OrganizationSwitcher';

interface SearchResult {
  type: 'ticket' | 'user' | 'organization';
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  status?: string;
}

interface HeaderProps {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { data: session, status } = useSession();
  const { photoUrl } = useProfilePhoto(status === 'authenticated');
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`/api/devops/search?q=${encodeURIComponent(searchQuery)}`);
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.results || []);
          setShowSearchResults(true);
          setSelectedIndex(-1);
        }
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Keyboard shortcut (Cmd/Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSearchResults || searchResults.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        const result = searchResults[selectedIndex];
        router.push(result.url);
        setShowSearchResults(false);
        setSearchQuery('');
      } else if (e.key === 'Escape') {
        setShowSearchResults(false);
        searchInputRef.current?.blur();
      }
    },
    [showSearchResults, searchResults, selectedIndex, router]
  );

  const getResultIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'ticket':
        return <Ticket size={16} style={{ color: 'var(--primary)' }} />;
      case 'user':
        return <Users size={16} style={{ color: 'var(--status-progress)' }} />;
      case 'organization':
        return <Building2 size={16} style={{ color: 'var(--status-pending)' }} />;
    }
  };

  return (
    <header
      className="flex h-14 items-center justify-between border-b px-2 sm:px-4"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Mobile menu button */}
      <button
        onClick={() => onMenuClick?.()}
        className="mr-2 rounded-md p-2 transition-colors hover:bg-[var(--surface-hover)] md:hidden"
        style={{ color: 'var(--text-secondary)' }}
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>

      {/* Search */}
      <div className="flex max-w-xl flex-1 items-center">
        <div className="relative w-full" ref={searchContainerRef}>
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            {isSearching ? (
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary)' }} />
            ) : (
              <Search size={18} style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search tickets, users, projects... (Ctrl+K)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
            className="input w-full py-2 pr-4 text-sm"
            style={{ paddingLeft: '2.75rem' }}
            role="combobox"
            aria-expanded={showSearchResults}
            aria-autocomplete="list"
            aria-controls="search-results-listbox"
            aria-activedescendant={
              selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined
            }
          />

          {/* Search Results Dropdown */}
          {showSearchResults && (
            <div
              id="search-results-listbox"
              role="listbox"
              aria-label="Search results"
              className="absolute top-full left-0 z-50 mt-1 w-full rounded-lg py-2 shadow-lg"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              {searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No results found for &quot;{searchQuery}&quot;
                </div>
              ) : (
                <>
                  {searchResults.map((result, index) => (
                    <Link
                      key={`${result.type}-${result.id}`}
                      id={`search-result-${index}`}
                      role="option"
                      aria-selected={index === selectedIndex}
                      href={result.url}
                      onClick={() => {
                        setShowSearchResults(false);
                        setSearchQuery('');
                      }}
                      className="flex items-center gap-3 px-4 py-2 transition-colors"
                      style={{
                        backgroundColor:
                          index === selectedIndex ? 'var(--surface-hover)' : 'transparent',
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      {getResultIcon(result.type)}
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {result.title}
                        </p>
                        {result.subtitle && (
                          <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                            {result.subtitle}
                          </p>
                        )}
                      </div>
                      <span
                        className="rounded px-2 py-0.5 text-xs capitalize"
                        style={{
                          backgroundColor: 'var(--surface-hover)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {result.type}
                      </span>
                    </Link>
                  ))}
                  <div
                    className="mt-2 border-t px-4 py-2 text-xs"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    <kbd className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5">↑</kbd>
                    <kbd className="ml-1 rounded bg-[var(--surface-hover)] px-1.5 py-0.5">↓</kbd>
                    <span className="ml-2">to navigate</span>
                    <kbd className="ml-3 rounded bg-[var(--surface-hover)] px-1.5 py-0.5">↵</kbd>
                    <span className="ml-2">to select</span>
                    <kbd className="ml-3 rounded bg-[var(--surface-hover)] px-1.5 py-0.5">esc</kbd>
                    <span className="ml-2">to close</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right side actions */}
      <div className="ml-2 flex items-center gap-1 sm:ml-4 sm:gap-2">
        {/* Organization Switcher */}
        <OrganizationSwitcher />

        {/* Notifications */}
        <button
          className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] sm:p-2"
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
            <Avatar name={session?.user?.name || 'User'} image={photoUrl ?? undefined} size="sm" />
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
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
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
