'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import type { User } from '@/types';
import Avatar from './Avatar';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

interface MentionUser extends User {
  matchScore?: number;
}

export default function MentionInput({
  value,
  onChange,
  placeholder = 'Type your message...',
  className = '',
  disabled = false,
}: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<MentionUser[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [hasLoadedUsers, setHasLoadedUsers] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch users when component mounts or when mention is triggered
  const fetchUsers = useCallback(async () => {
    if (hasLoadedUsers || isLoadingUsers) return;

    setIsLoadingUsers(true);
    try {
      const response = await fetch('/api/devops/users');
      if (response.ok) {
        const data = await response.json();
        setAllUsers(data.users || []);
        setHasLoadedUsers(true);
      }
    } catch (error) {
      console.error('Failed to fetch users for mentions:', error);
    } finally {
      setIsLoadingUsers(false);
    }
  }, [hasLoadedUsers, isLoadingUsers]);

  // Filter users based on query
  const filterUsers = useCallback(
    (query: string): MentionUser[] => {
      if (!query) {
        // Return first 8 users when no query
        return allUsers.slice(0, 8);
      }

      const lowerQuery = query.toLowerCase();
      const filtered = allUsers
        .map((user) => {
          const displayNameLower = user.displayName.toLowerCase();
          const emailLower = (user.email || '').toLowerCase();

          // Calculate match score for better sorting
          let matchScore = 0;
          if (displayNameLower.startsWith(lowerQuery)) {
            matchScore = 100;
          } else if (displayNameLower.includes(lowerQuery)) {
            matchScore = 50;
          } else if (emailLower.startsWith(lowerQuery)) {
            matchScore = 40;
          } else if (emailLower.includes(lowerQuery)) {
            matchScore = 20;
          }

          return { ...user, matchScore };
        })
        .filter((user) => user.matchScore > 0)
        .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
        .slice(0, 8);

      return filtered;
    },
    [allUsers]
  );

  // Debounced filter
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (showSuggestions) {
      debounceRef.current = setTimeout(() => {
        const filtered = filterUsers(mentionQuery);
        setSuggestions(filtered);
        setSelectedIndex(0);
      }, 100); // 100ms debounce
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [mentionQuery, showSuggestions, filterUsers]);

  // Handle text change
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    onChange(newValue);

    // Check if we should show mention suggestions
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      // Check if @ is at start or preceded by whitespace
      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0) {
        const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
        // Only show if there's no space after @ (still typing the mention)
        if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
          setMentionStartIndex(lastAtIndex);
          setMentionQuery(textAfterAt);
          setShowSuggestions(true);
          fetchUsers();
          return;
        }
      }
    }

    // Hide suggestions if no valid mention context
    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Enter':
        if (showSuggestions && suggestions.length > 0) {
          e.preventDefault();
          selectUser(suggestions[selectedIndex]);
        }
        break;
      case 'Tab':
        if (showSuggestions && suggestions.length > 0) {
          e.preventDefault();
          selectUser(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowSuggestions(false);
        break;
    }
  };

  // Select a user from suggestions
  const selectUser = (user: MentionUser) => {
    if (mentionStartIndex === -1) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    // Create the mention text - use displayName for readability
    const mentionText = `@${user.displayName} `;

    // Replace the @query with the mention
    const beforeMention = value.slice(0, mentionStartIndex);
    const afterMention = value.slice(mentionStartIndex + 1 + mentionQuery.length);
    const newValue = beforeMention + mentionText + afterMention;

    onChange(newValue);

    // Close suggestions
    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);

    // Set cursor position after the mention
    const newCursorPos = mentionStartIndex + mentionText.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  };

  // Scroll selected item into view
  useEffect(() => {
    if (suggestionsRef.current && showSuggestions) {
      const selectedEl = suggestionsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, showSuggestions]);

  // Calculate dropdown position
  const getDropdownPosition = () => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };

    // Position above the textarea
    return {
      bottom: '100%',
      left: 0,
      marginBottom: '4px',
    };
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />

      {/* Mention suggestions dropdown */}
      {showSuggestions && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 max-h-48 w-64 overflow-auto rounded-md shadow-lg"
          style={{
            ...getDropdownPosition(),
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
          role="listbox"
        >
          {isLoadingUsers ? (
            <div
              className="flex items-center justify-center p-3 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Loading users...
            </div>
          ) : suggestions.length === 0 ? (
            <div className="p-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              No users found
            </div>
          ) : (
            suggestions.map((user, index) => (
              <button
                key={user.id}
                onClick={() => selectUser(user)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  index === selectedIndex ? 'bg-[var(--surface-hover)]' : ''
                }`}
                style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                role="option"
                aria-selected={index === selectedIndex}
              >
                <Avatar name={user.displayName} image={user.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{user.displayName}</div>
                  {user.email && (
                    <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      {user.email}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
