/**
 * The tickets view someone opens by default (#7729), such as "Your active
 * tickets" instead of every unsolved ticket.
 *
 * Kept in this browser (localStorage): a convenience, so losing it only means
 * the Tickets page opens on its usual view. Every read and write tolerates
 * storage being blocked. Components follow changes through useDefaultView.
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'zapdesk:default-view';
const CHANGE_EVENT = 'zapdesk:default-view-change';

/** The views that can be the default: the sidebar's ticket views. */
export const DEFAULT_VIEW_IDS = [
  'your-active',
  'unassigned',
  'all-active',
  'recently-updated',
  'created-today',
  'pending',
  'recently-solved',
] as const;

export type DefaultViewId = (typeof DEFAULT_VIEW_IDS)[number];

/** The view the Tickets page opens on when none is asked for. */
export const FALLBACK_VIEW = 'all-unsolved';

export function isDefaultViewId(value: unknown): value is DefaultViewId {
  return typeof value === 'string' && (DEFAULT_VIEW_IDS as readonly string[]).includes(value);
}

/** The saved default view, or null when none is saved or it is no longer a view. */
export function readDefaultView(): DefaultViewId | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isDefaultViewId(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Save a default view, or clear it with null. */
export function saveDefaultView(view: DefaultViewId | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (view) window.localStorage.setItem(STORAGE_KEY, view);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The view to show for the address's `view` parameter. */
export function viewToShow(requested: string | null, saved: DefaultViewId | null): string {
  return requested || saved || FALLBACK_VIEW;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // Another tab changed it.
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** The saved default view, kept up to date as it changes. Null on the server. */
export function useDefaultView(): DefaultViewId | null {
  return useSyncExternalStore(subscribe, readDefaultView, () => null);
}
