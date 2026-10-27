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
import { useProfilePhoto, useDevOpsApi } from '@/hooks';
import OrganizationSwitcher from './OrganizationSwitcher';
import SourceSwitcher from './SourceSwitcher';

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
  const { get: getDevOps, hasOrganization } = useDevOpsApi();
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  // Projects whose work items the search could not read, so "no results" can
  // be told apart from "no results in what I could read" (#516).
  const [searchFailedProjects, setSearchFailedProjects] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      setSearchFailedProjects([]);
      setShowSearchResults(false);
      // A request may be in flight and about to be aborted below, and its
      // `finally` will not run for an aborted fetch -- so clear the spinner
      // here rather than leave it turning over an emptied box.
      setIsSearching(false);
      return;
    }
    if (!hasOrganization) {
      setIsSearching(false);
      return;
    }

    // The warning belongs to the query that produced it. Dropping it as soon
    // as the query changes covers every way the next request can fail to
    // replace it -- still in flight, non-OK, or thrown -- rather than only the
    // one path. Raised by CodeRabbit on #520.
    setSearchFailedProjects([]);

    // Clearing the timeout only cancels a debounce that has not fired yet.
    // Once the request is away, nothing stopped its response from arriving
    // after a later query's and restoring the earlier query's results and
    // warning under the newer text. Aborting both drops that response and
    // saves the round trip. Raised by CodeRabbit on #520.
    const controller = new AbortController();

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await getDevOps(
          `/api/devops/search?q=${encodeURIComponent(searchQuery)}`,
          { signal: controller.signal }
        );
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.results || []);
          setSearchFailedProjects(data.failedProjects ?? []);
          setShowSearchResults(true);
          setSelectedIndex(-1);
        }
      } catch (error) {
        // An abort is this search being superseded, not a failure.
        if ((error as Error)?.name === 'AbortError') return;
        console.error('Search failed:', error);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchQuery, getDevOps, hasOrganization]);

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
        return <Ticket size={16} style={{ color: 'var(--color-brand)' }} />;
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
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-brand)' }} />
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
                  {searchFailedProjects.length > 0 ? (
                    <>
                      No results found for &quot;{searchQuery}&quot; in the projects that could be
                      searched. Could not search {searchFailedProjects.join(', ')}.
                    </>
                  ) : (
                    <>No results found for &quot;{searchQuery}&quot;</>
                  )}
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
                  {searchFailedProjects.length > 0 && (
                    // With results on screen the list looks complete, so say
                    // what is missing from it (#516).
                    <p
                      className="mt-2 border-t px-4 py-2 text-xs"
                      style={{ borderColor: 'var(--border)', color: 'var(--warning)' }}
                    >
                      Could not search {searchFailedProjects.join(', ')}, so there may be more.
                    </p>
                  )}
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
        {/* Source toggle: Azure DevOps, GitHub or both */}
        <SourceSwitcher />

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
