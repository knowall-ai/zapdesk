'use client';

import { ArrowDownUp } from 'lucide-react';
import { saveCommentOrder, type CommentOrder } from '@/lib/comment-order';

interface CommentOrderToggleProps {
  order: CommentOrder;
}

/** Switches a conversation between oldest first (the default) and newest first. */
export default function CommentOrderToggle({ order }: CommentOrderToggleProps) {
  const next: CommentOrder = order === 'oldest' ? 'newest' : 'oldest';
  return (
    <button
      type="button"
      onClick={() => saveCommentOrder(next)}
      className="flex items-center gap-1 rounded px-2 py-1 text-xs normal-case hover:bg-[var(--surface-hover)]"
      style={{ color: 'var(--text-muted)' }}
      title={`Show ${next} first`}
      aria-label={`Comments are ${order} first. Show ${next} first`}
    >
      <ArrowDownUp size={12} />
      {order === 'oldest' ? 'Oldest first' : 'Newest first'}
    </button>
  );
}
