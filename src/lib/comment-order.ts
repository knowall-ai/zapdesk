/**
 * The order a ticket's conversation is shown in.
 *
 * Oldest first by default, so a thread reads top to bottom like the email
 * chain or the Zendesk ticket it came from, with the latest message at the
 * bottom. Anyone who prefers the newest at the top (#486) can switch, and the
 * choice is kept in this browser (localStorage). Ties (same timestamp) fall
 * back to the comment id, which DevOps assigns in posting order.
 */
import { useSyncExternalStore } from 'react';

export type CommentOrder = 'oldest' | 'newest';

/** Where the choice is kept. Exported so tests assert against this, not a copy. */
export const STORAGE_KEY = 'zapdesk:comment-order';
const CHANGE_EVENT = 'zapdesk:comment-order-change';
export const DEFAULT_COMMENT_ORDER: CommentOrder = 'oldest';

// A choice made in this page that could not be saved, so the button still
// works until reload. Cleared by any successful save, so changes made in other
// tabs show again.
let unsaved: CommentOrder | null = null;

type Orderable = { id: number | string; createdAt: Date | string };

function time(c: Orderable): number {
  const t = new Date(c.createdAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Earliest first; the list given is not changed. */
export function oldestFirst<T extends Orderable>(comments: readonly T[]): T[] {
  return [...comments].sort((a, b) => time(a) - time(b) || Number(a.id) - Number(b.id));
}

/** Latest first; the list given is not changed. */
export function newestFirst<T extends Orderable>(comments: readonly T[]): T[] {
  return oldestFirst(comments).reverse();
}

export function orderComments<T extends Orderable>(
  comments: readonly T[],
  order: CommentOrder
): T[] {
  return order === 'newest' ? newestFirst(comments) : oldestFirst(comments);
}

/** An unsaved choice from this page, else the saved order, else the default. */
export function readCommentOrder(): CommentOrder {
  if (typeof window === 'undefined') return DEFAULT_COMMENT_ORDER;
  if (unsaved) return unsaved;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'newest' || saved === 'oldest') return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return DEFAULT_COMMENT_ORDER;
}

export function saveCommentOrder(order: CommentOrder): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, order);
    unsaved = null;
  } catch {
    unsaved = order;
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

/** The saved order, kept up to date as it changes. */
export function useCommentOrder(): CommentOrder {
  return useSyncExternalStore(subscribe, readCommentOrder, () => DEFAULT_COMMENT_ORDER);
}
