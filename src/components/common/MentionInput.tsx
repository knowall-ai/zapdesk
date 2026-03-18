'use client';

import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import type { User } from '@/types';
import Avatar from './Avatar';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

interface MentionUser extends User {
  matchScore?: number;
}

/** Extract plain text from the contentEditable innerHTML (strips tags except img). */
function getTextContent(el: HTMLDivElement): string {
  // Walk child nodes: keep text nodes and img tags, convert <br>/<div> to newlines
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName;
      if (tag === 'IMG') {
        const src = (node as HTMLImageElement).src;
        const alt = (node as HTMLImageElement).alt || 'image';
        text += `<img src="${src}" alt="${alt}" />`;
      } else if (tag === 'BR') {
        text += '\n';
      } else if (tag === 'DIV' || tag === 'P') {
        if (text.length > 0 && !text.endsWith('\n')) text += '\n';
        node.childNodes.forEach(walk);
        return;
      }
      node.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
  return text;
}

/** Get cursor offset in plain text terms within the contentEditable. */
function getCursorOffset(el: HTMLDivElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;

  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

export default function MentionInput({
  value,
  onChange,
  onPaste,
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
  const [isEmpty, setIsEmpty] = useState(true);

  const editorRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInternalUpdate = useRef(false);

  // Sync external value changes into the editor
  useEffect(() => {
    const el = editorRef.current;
    if (!el || isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }

    // Only sync if the value has actually changed from what's in the editor
    const currentText = getTextContent(el);
    if (currentText !== value) {
      // Convert value to HTML: preserve img tags, convert newlines to <br>
      const html = value
        .replace(/(<img [^>]+>)/g, '\x00$1\x00') // protect img tags
        .split('\x00')
        .map((part) => {
          if (part.startsWith('<img ')) return part;
          return part
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        })
        .join('');
      el.innerHTML = html || '';
    }
    setIsEmpty(!value);
  }, [value]);

  // Fetch users
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

  // Filter users
  const filterUsers = useCallback(
    (query: string): MentionUser[] => {
      if (!query) return allUsers.slice(0, 8);
      const lowerQuery = query.toLowerCase();
      return allUsers
        .map((user) => {
          const dn = user.displayName.toLowerCase();
          const em = (user.email || '').toLowerCase();
          let matchScore = 0;
          if (dn.startsWith(lowerQuery)) matchScore = 100;
          else if (dn.includes(lowerQuery)) matchScore = 50;
          else if (em.startsWith(lowerQuery)) matchScore = 40;
          else if (em.includes(lowerQuery)) matchScore = 20;
          return { ...user, matchScore };
        })
        .filter((u) => u.matchScore > 0)
        .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
        .slice(0, 8);
    },
    [allUsers]
  );

  // Debounced filter
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (showSuggestions) {
      debounceRef.current = setTimeout(() => {
        setSuggestions(filterUsers(mentionQuery));
        setSelectedIndex(0);
      }, 100);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mentionQuery, showSuggestions, filterUsers]);

  // Handle input in the contentEditable
  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;

    const text = getTextContent(el);
    isInternalUpdate.current = true;
    onChange(text);
    setIsEmpty(!text.trim());

    // Check for mention trigger
    const cursorPos = getCursorOffset(el);
    const textBeforeCursor = text.replace(/<img [^>]+>/g, '').slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
        const afterAt = textBeforeCursor.slice(lastAtIndex + 1);
        if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
          setMentionStartIndex(lastAtIndex);
          setMentionQuery(afterAt);
          setShowSuggestions(true);
          fetchUsers();
          return;
        }
      }
    }

    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
  };

  // Keyboard navigation for mentions
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        if (suggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        }
        break;
      case 'ArrowUp':
        if (suggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        }
        break;
      case 'Enter':
        if (suggestions.length > 0) {
          e.preventDefault();
          selectUser(suggestions[selectedIndex]);
        }
        break;
      case 'Tab':
        if (suggestions.length > 0) {
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

  // Select a mention user
  const selectUser = (user: MentionUser) => {
    if (mentionStartIndex === -1) return;
    const el = editorRef.current;
    if (!el) return;

    const mentionText = `@${user.displayName} `;
    const text = getTextContent(el);
    // Strip img tags for text-position calculation
    const plainText = text.replace(/<img [^>]+>/g, '');
    const before = plainText.slice(0, mentionStartIndex);
    const after = plainText.slice(mentionStartIndex + 1 + mentionQuery.length);
    const newValue = before + mentionText + after;

    // Re-insert any img tags that were in the original value
    const imgTags: string[] = [];
    text.replace(/<img [^>]+>/g, (match) => {
      imgTags.push(match);
      return '';
    });
    let finalValue = newValue;
    for (const img of imgTags) {
      if (!finalValue.includes(img)) {
        finalValue = finalValue + '\n' + img;
      }
    }

    isInternalUpdate.current = false; // Allow sync
    onChange(finalValue);

    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);

    requestAnimationFrame(() => el.focus());
  };

  // Handle paste — delegate to parent for image handling
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Debug: log clipboard contents
    console.log('[MentionInput paste]', {
      filesCount: e.clipboardData?.files?.length,
      fileTypes: e.clipboardData?.files
        ? Array.from(e.clipboardData.files).map((f) => f.type)
        : [],
      itemsCount: e.clipboardData?.items?.length,
      itemTypes: e.clipboardData?.items
        ? Array.from(e.clipboardData.items).map((i) => `${i.kind}:${i.type}`)
        : [],
      hasOnPaste: !!onPaste,
    });

    // Check for images in clipboardData.files (Chrome/Edge screenshots)
    const hasFileImages =
      e.clipboardData?.files?.length > 0 &&
      Array.from(e.clipboardData.files).some((f) => f.type.startsWith('image/'));

    // Also check clipboardData.items (Firefox, some Windows paste scenarios)
    const hasItemImages =
      !hasFileImages &&
      e.clipboardData?.items &&
      Array.from(e.clipboardData.items).some(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );

    if ((hasFileImages || hasItemImages) && onPaste) {
      onPaste(e);
      return;
    }

    // For non-image paste, strip HTML formatting and insert as plain text
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
    // If no text and no images, let the browser handle it (e.g. empty paste)
  };

  // Scroll selected into view
  useEffect(() => {
    if (suggestionsRef.current && showSuggestions) {
      const el = suggestionsRef.current.children[selectedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, showSuggestions]);

  return (
    <div className="relative">
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className={`${className} user-content`}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        style={{ minHeight: '100px', overflowY: 'auto' }}
      />
      {/* Placeholder overlay */}
      {isEmpty && (
        <div
          className="pointer-events-none absolute top-0 left-0 px-3 py-2 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          {placeholder}
        </div>
      )}

      {/* Mention suggestions dropdown */}
      {showSuggestions && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 max-h-48 w-64 overflow-auto rounded-md shadow-lg"
          style={{
            bottom: '100%',
            left: 0,
            marginBottom: '4px',
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
