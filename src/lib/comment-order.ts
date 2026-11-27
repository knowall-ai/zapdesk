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

// The choice made in this page, used when storage is blocked so the button
// still works until the page is reloaded.
let chosen: CommentOrder | null = null;

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

/** The saved order; the in-page choice when nothing could be saved; else the default. */
export function readCommentOrder(): CommentOrder {
  if (typeof window === 'undefined') return DEFAULT_COMMENT_ORDER;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'newest' || saved === 'oldest') return saved;
    if (saved !== null) return DEFAULT_COMMENT_ORDER;
  } catch {
    // Storage blocked: fall through to the in-page choice.
  }
  return chosen ?? DEFAULT_COMMENT_ORDER;
}

export function saveCommentOrder(order: CommentOrder): void {
  if (typeof window === 'undefined') return;
  chosen = order;
  try {
    window.localStorage.setItem(STORAGE_KEY, order);
  } catch {
    // Storage blocked: `chosen` keeps it until the page is reloaded.
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
