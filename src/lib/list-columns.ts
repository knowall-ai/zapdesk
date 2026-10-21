/**
 * Which columns a tickets or work items list shows (#7397).
 *
 * Each list offers its own columns; people hide the ones they don't need.
 * Subject and the selection checkbox always stay: without them a row can't be
 * read or acted on. Kept in this browser (localStorage), per kind of list, so
 * a list that adds a column later still shows it until someone hides it.
 */
import { useMemo, useSyncExternalStore } from 'react';

const PREFIX = 'zapdesk:hidden-columns:';
const CHANGE_EVENT = 'zapdesk:hidden-columns-change';

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
  try {
    return window.localStorage.getItem(PREFIX + listKey) ?? '[]';
  } catch {
    return '[]';
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
  try {
    window.localStorage.setItem(PREFIX + listKey, JSON.stringify([...next].sort()));
  } catch {
    // Storage blocked: nothing is remembered, and the list shows every column.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Show every column of a kind of list again. */
export function resetColumns(listKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFIX + listKey);
  } catch {
    // Storage blocked: there is nothing saved to clear.
  }
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
