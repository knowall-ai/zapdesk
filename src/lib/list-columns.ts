/**
 * Which columns a tickets or work items list shows (#7397).
 *
 * Each list offers its own columns; people hide the ones they don't need.
 * Subject and the selection checkbox always stay: without them a row can't be
 * read or acted on. Kept in this browser (localStorage), per kind of list, so
 * a list that adds a column later still shows it until someone hides it.
 * When storage is blocked the choice lasts until the page reloads.
 */
import { useMemo, useSyncExternalStore } from 'react';

const PREFIX = 'zapdesk:hidden-columns:';
const CHANGE_EVENT = 'zapdesk:hidden-columns-change';

/**
 * The choices for this page load, used once storage refuses a read or a
 * write (blocked or full), so hiding a column still works until reload.
 */
const memory = new Map<string, string>();
let storageFailed = false;

/** Columns that can't be hidden. */
export const FIXED_COLUMNS: readonly string[] = ['checkbox', 'subject'];

export function canHideColumn(id: string): boolean {
  return !FIXED_COLUMNS.includes(id);
}

/** The columns to draw: all offered, minus the hidden ones that may be hidden. */
export function visibleColumns<T extends { id: string }>(
  columns: readonly T[],
  hidden: ReadonlySet<string>
): T[] {
  return columns.filter((column) => !hidden.has(column.id) || !canHideColumn(column.id));
}

function read(listKey: string): string {
  if (typeof window === 'undefined') return '[]';
  if (storageFailed) return memory.get(listKey) ?? '[]';
  try {
    return window.localStorage.getItem(PREFIX + listKey) ?? '[]';
  } catch {
    storageFailed = true;
    return memory.get(listKey) ?? '[]';
  }
}

function write(listKey: string, value: string | null): void {
  if (value === null) memory.delete(listKey);
  else memory.set(listKey, value);
  if (storageFailed) return;
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + listKey);
    else window.localStorage.setItem(PREFIX + listKey, value);
  } catch {
    // Blocked or full: carry on from memory for the rest of this page load.
    storageFailed = true;
  }
}

function parse(raw: string): Set<string> {
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The hidden columns saved for a kind of list. */
export function readHiddenColumns(listKey: string): Set<string> {
  return parse(read(listKey));
}

/** Show or hide one column of a kind of list. */
export function setColumnHidden(listKey: string, id: string, hidden: boolean): void {
  if (typeof window === 'undefined' || !canHideColumn(id)) return;
  const next = readHiddenColumns(listKey);
  if (hidden) next.add(id);
  else next.delete(id);
  write(listKey, JSON.stringify([...next].sort()));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Show every column of a kind of list again. */
export function resetColumns(listKey: string): void {
  if (typeof window === 'undefined') return;
  write(listKey, null);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** The hidden columns of a kind of list, kept up to date. None on the server. */
export function useHiddenColumns(listKey: string): Set<string> {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(listKey),
    () => '[]'
  );
  return useMemo(() => parse(raw), [raw]);
}

/** For tests: forget the in-memory fallback. */
export function resetColumnMemory(): void {
  memory.clear();
  storageFailed = false;
}
