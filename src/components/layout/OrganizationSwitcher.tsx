'use client';

import { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check, Loader2 } from 'lucide-react';
import { useOrganization } from '@/components/providers/OrganizationProvider';

export default function OrganizationSwitcher() {
  const { organizations, selectedOrganization, setSelectedOrganization, isLoading } =
    useOrganization();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Don't render if only one organization or still loading with no orgs
  if (isLoading && organizations.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md px-3 py-1.5">
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  // Hide if only one organization
  if (organizations.length <= 1) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
        style={{ color: 'var(--text-primary)' }}
        aria-haspopup="listbox"
        aria-expanded={showDropdown}
        aria-label="Switch organization"
      >
        <Building2 size={16} style={{ color: 'var(--primary)' }} />
        <span className="max-w-[150px] truncate text-sm font-medium">
          {selectedOrganization?.accountName || 'Select Organization'}
        </span>
        <ChevronDown
          size={14}
          style={{ color: 'var(--text-muted)' }}
          className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`}
        />
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
          <div
            role="listbox"
            aria-label="Organizations"
            className="absolute top-full left-0 z-20 mt-1 min-w-[200px] rounded-lg py-1 shadow-lg"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div
              className="border-b px-3 py-2 text-xs font-semibold tracking-wider uppercase"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Organizations
            </div>
            {organizations.map((org) => (
              <button
                key={org.accountId}
                role="option"
                aria-selected={selectedOrganization?.accountId === org.accountId}
                onClick={() => {
                  setSelectedOrganization(org);
                  setShowDropdown(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-primary)' }}
              >
                <Building2 size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="flex-1 truncate">{org.accountName}</span>
                {selectedOrganization?.accountId === org.accountId && (
                  <Check size={14} style={{ color: 'var(--primary)' }} />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
