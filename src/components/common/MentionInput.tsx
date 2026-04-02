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

/** Escape HTML attribute values to prevent injection. */
function escapeAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Validate that a URL is safe (relative or http/https). */
function isSafeUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  if (url.startsWith('data:image/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Sanitize an img tag string — only allow safe src and plain alt. */
function sanitizeImgTag(src: string, alt: string): string {
  if (!isSafeUrl(src)) return '';
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`;
}

/** Extract plain text from the contentEditable innerHTML (strips tags except img). */
function getTextContent(el: HTMLDivElement): string {
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName;
      if (tag === 'IMG') {
        const src = (node as HTMLImageElement).src;
        const alt = (node as HTMLImageElement).alt || 'image';
        const sanitized = sanitizeImgTag(src, alt);
        if (sanitized) text += sanitized;
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

/**
 * Convert a value string to safe HTML for the contentEditable.
 * Only whitelisted <img> tags (with safe src) are preserved; everything else is escaped.
 */
function valueToSafeHtml(value: string): string {
  // Split on img tags, validate each one, escape everything else
  const IMG_REGEX = /<img\s+src="([^"]*?)"\s+alt="([^"]*?)"\s*\/?>/g;
  let lastIndex = 0;
  let html = '';
  let match;

  while ((match = IMG_REGEX.exec(value)) !== null) {
    // Escape text before this img tag
    const before = value.slice(lastIndex, match.index);
    html += before
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    // Validate and re-build img tag with escaped attributes
    const src = match[1];
    const alt = match[2];
    const sanitized = sanitizeImgTag(src, alt);
    if (sanitized) {
      html += sanitized;
    }

    lastIndex = match.index + match[0].length;
  }

  // Escape remaining text after last img tag
  const remaining = value.slice(lastIndex);
  html += remaining
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return html;
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

    const currentText = getTextContent(el);
    if (currentText !== value) {
      el.innerHTML = valueToSafeHtml(value) || '';
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

    isInternalUpdate.current = false;
    onChange(finalValue);

    setShowSuggestions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);

    requestAnimationFrame(() => el.focus());
  };

  // Handle paste — always preventDefault to block raw HTML injection
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Check for images in clipboard
    const hasFileImages =
      e.clipboardData?.files?.length > 0 &&
      Array.from(e.clipboardData.files).some((f) => f.type.startsWith('image/'));

    const hasItemImages =
      !hasFileImages &&
      e.clipboardData?.items &&
      Array.from(e.clipboardData.items).some(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );

    if ((hasFileImages || hasItemImages) && onPaste) {
      // Delegate image handling to parent — parent must call preventDefault
      onPaste(e);
      return;
    }

    // Always prevent default to block arbitrary HTML injection from clipboard
    e.preventDefault();

    // Insert plain text only (strip any HTML formatting)
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) {
      document.execCommand('insertText', false, text);
    }
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
        style={{ overflowY: 'auto' }}
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
