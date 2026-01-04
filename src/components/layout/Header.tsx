'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  MessageSquare,
  Bell,
  Grid3X3,
  HelpCircle,
  ChevronDown,
  LogOut,
  User,
  Settings,
  Ticket,
  Users,
  Building2,
  Command,
} from 'lucide-react';
import type { SearchResult, SearchResponse } from '@/types';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

function SearchResultIcon({ type }: { type: SearchResult['type'] }) {
  const iconProps = { size: 16 };

  switch (type) {
    case 'ticket':
      return <Ticket {...iconProps} />;
    case 'customer':
      return <Users {...iconProps} />;
    case 'organization':
      return <Building2 {...iconProps} />;
    default:
      return <Search {...iconProps} />;
  }
}

export default function Header() {
  const { data: session } = useSession();
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(searchQuery, 300);

  // Fetch search results when debounced query changes
  useEffect(() => {
    async function fetchResults() {
      if (!debouncedQuery || debouncedQuery.length < 2) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(`/api/devops/search?q=${encodeURIComponent(debouncedQuery)}`);
        if (response.ok) {
          const data: SearchResponse = await response.json();
          setSearchResults(data.results);
        }
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }

    fetchResults();
  }, [debouncedQuery]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchResults]);

  // Handle keyboard shortcut Cmd/Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowResults(true);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navigateToResult = useCallback(
    (result: SearchResult) => {
      router.push(result.url);
      setSearchQuery('');
      setSearchResults([]);
      setShowResults(false);
    },
    [router]
  );

  // Handle keyboard navigation in results
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showResults || searchResults.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && searchResults[selectedIndex]) {
            navigateToResult(searchResults[selectedIndex]);
          }
          break;
        case 'Escape':
          setShowResults(false);
          searchInputRef.current?.blur();
          break;
      }
    },
    [showResults, searchResults, selectedIndex, navigateToResult]
  );

  const hasResults = searchResults.length > 0;
  const showDropdown = showResults && (hasResults || isSearching || searchQuery.length >= 2);

  return (
    <header
      className="flex h-14 items-center justify-between border-b px-4"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Search */}
      <div className="flex max-w-xl flex-1 items-center">
        <div ref={searchContainerRef} className="relative w-full">
          <Search
            size={18}
            className="absolute top-1/2 left-3 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search tickets, customers, organizations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowResults(true)}
            onKeyDown={handleKeyDown}
            className="input w-full py-2 pr-16 pl-10 text-sm"
          />
          <kbd
            className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 rounded border px-1.5 py-0.5 text-xs sm:flex"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-muted)',
              backgroundColor: 'var(--background)',
            }}
          >
            <Command size={10} />K
          </kbd>

          {/* Search Results Dropdown */}
          {showDropdown && (
            <div
              className="absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-lg shadow-lg"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              {isSearching ? (
                <div
                  className="flex items-center justify-center py-4 text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Searching...
                </div>
              ) : hasResults ? (
                <ul className="max-h-80 overflow-y-auto py-1">
                  {searchResults.map((result, index) => (
                    <li key={`${result.type}-${result.id}`}>
                      <button
                        onClick={() => navigateToResult(result)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                        style={{
                          backgroundColor:
                            selectedIndex === index ? 'var(--surface-hover)' : 'transparent',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span
                          className="flex-shrink-0 rounded p-1"
                          style={{
                            backgroundColor:
                              result.type === 'ticket'
                                ? 'var(--primary)'
                                : result.type === 'organization'
                                  ? 'var(--status-pending)'
                                  : 'var(--status-open)',
                            color: 'white',
                          }}
                        >
                          <SearchResultIcon type={result.type} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{result.title}</p>
                          {result.subtitle && (
                            <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                              {result.subtitle}
                            </p>
                          )}
                        </div>
                        <span
                          className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs capitalize"
                          style={{
                            backgroundColor: 'var(--background)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {result.type}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : searchQuery.length >= 2 ? (
                <div className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No results found for &quot;{searchQuery}&quot;
                </div>
              ) : null}
            </div>
          )}
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

        {/* Apps grid */}
        <button
          className="rounded-md p-2 transition-colors hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Grid3X3 size={20} />
        </button>

        {/* Help */}
        <button
          className="rounded-md p-2 transition-colors hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <HelpCircle size={20} />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-[var(--surface-hover)]"
          >
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium"
              style={{ backgroundColor: 'var(--primary)', color: 'white' }}
            >
              {session?.user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
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
