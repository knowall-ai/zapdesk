/**
 * Where the user was on the Kanban board: which groups were open, and how far
 * down they had scrolled (#318).
 *
 * The board starts with every group closed. Opening a work item's full page
 * and coming back therefore lost the user's place: they had to find and
 * reopen the group, then scroll to the card again. Both are kept for the
 * browser session, so a new tab or a new day starts clean.
 *
 * Everything here tolerates storage that is missing, full or holding
 * something unexpected: losing the position is harmless, breaking the board
 * is not.
 */

const EXPANDED_KEY = 'zapdesk:kanban:expanded';
const SCROLL_KEY = 'zapdesk:kanban:scroll';
/** Ceiling on remembered groups per scope, so the entry cannot grow without limit. */
const MAX_GROUPS = 200;

export type PositionStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The session's storage, or null where there is none (server render, blocked storage). */
export function sessionPositionStorage(): PositionStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson(storage: PositionStorage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: PositionStorage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the position is simply not remembered.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The groups left open in `scope`. A scope is one way of looking at the board
 * (an organization grouped by project, say), so a person and a project that
 * share a name do not open each other.
 */
export function readExpandedGroups(storage: PositionStorage | null, scope: string): string[] {
  const all = readJson(storage, EXPANDED_KEY);
  const groups = isRecord(all) ? all[scope] : null;
  return Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
}

export function writeGroupExpanded(
  storage: PositionStorage | null,
  scope: string,
  group: string,
  expanded: boolean
): void {
  const all = readJson(storage, EXPANDED_KEY);
  const next: Record<string, unknown> = isRecord(all) ? { ...all } : {};
  const groups = readExpandedGroups(storage, scope).filter((g) => g !== group);
  if (expanded) groups.push(group);
  // Keep the most recently opened when over the ceiling.
  next[scope] = groups.slice(-MAX_GROUPS);
  writeJson(storage, EXPANDED_KEY, next);
}

/** How far down the board was scrolled in `scope`, or 0 when nothing is remembered for it. */
export function readScrollTop(storage: PositionStorage | null, scope: string): number {
  const saved = readJson(storage, SCROLL_KEY);
  if (!isRecord(saved) || saved.scope !== scope) return 0;
  const top = saved.top;
  return typeof top === 'number' && Number.isFinite(top) && top > 0 ? top : 0;
}

export function writeScrollTop(storage: PositionStorage | null, scope: string, top: number): void {
  writeJson(storage, SCROLL_KEY, { scope, top: Math.max(0, Math.round(top)) });
}
