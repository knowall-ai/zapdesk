'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Send, Zap, Paperclip, Loader2 } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import type { TicketComment, User } from '@/types';

interface CommentSectionProps {
  comments: TicketComment[];
  isLoading?: boolean;
  onAddComment?: (comment: string) => Promise<void>;
  assignee?: User | null;
  onZapClick?: () => void;
  compact?: boolean;
}

export default function CommentSection({
  comments,
  isLoading = false,
  onAddComment,
  assignee,
  onZapClick,
  compact = false,
}: CommentSectionProps) {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!newComment.trim() || !onAddComment) return;
    setIsSubmitting(true);
    try {
      await onAddComment(newComment.trim());
      setNewComment('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const avatarSize = compact ? 'sm' : 'md';

  return (
    <div>
      {/* Comment list */}
      {isLoading ? (
        <div
          className="flex items-center gap-2 py-4 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          <Loader2 size={14} className="animate-spin" />
          Loading comments...
        </div>
      ) : comments.length === 0 ? (
        <p className="py-2 text-sm italic" style={{ color: 'var(--text-muted)' }}>
          No comments yet
        </p>
      ) : (
        <div className={compact ? 'mb-4 space-y-3' : 'mb-4 space-y-4'}>
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={`${compact ? 'rounded-md p-3' : 'card p-4'} ${comment.isInternal ? 'border-l-4' : ''}`}
              style={{
                ...(compact ? { backgroundColor: 'var(--surface)' } : {}),
                ...(comment.isInternal ? { borderLeftColor: 'var(--status-pending)' } : {}),
              }}
            >
              <div className={`flex items-start ${compact ? 'gap-2' : 'gap-3'}`}>
                <Avatar
                  name={comment.author.displayName}
                  image={comment.author.avatarUrl}
                  size={avatarSize}
                />
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`font-medium ${compact ? 'text-sm' : ''}`}
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {comment.author.displayName}
                    </span>
                    {comment.isInternal && (
                      <span
                        className="rounded px-1.5 py-0.5 text-xs"
                        style={{ backgroundColor: 'var(--status-pending)', color: 'white' }}
                      >
                        Internal note
                      </span>
                    )}
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {format(comment.createdAt, 'dd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                  <div
                    className={`user-content ${compact ? 'prose prose-sm prose-invert max-w-none text-sm' : 'text-sm'}`}
                    style={{ color: 'var(--text-secondary)' }}
                    dangerouslySetInnerHTML={{ __html: comment.content }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply box */}
      {onAddComment && (
        <div
          className={compact ? '' : 'border-t pt-4'}
          style={compact ? {} : { borderColor: 'var(--border)' }}
        >
          {!compact && (
            <div className="mb-3 flex items-center gap-2">
              <label className="flex cursor-not-allowed items-center gap-2">
                <input
                  type="checkbox"
                  checked
                  disabled
                  className="h-4 w-4 rounded accent-[var(--primary)]"
                />
                <span className="text-xs" style={{ color: 'var(--primary)' }}>
                  Public reply – all comments are visible to customers in DevOps
                </span>
              </label>
            </div>
          )}

          <div>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && compact) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={compact ? 'Add a comment...' : 'Type your reply...'}
              className={`input w-full resize-none ${compact ? 'min-h-[60px] text-sm' : 'min-h-[100px]'}`}
              disabled={isSubmitting}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => alert('Attachments not yet implemented')}
                className="rounded p-2 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-muted)' }}
                title="Attach file"
              >
                <Paperclip size={compact ? 14 : 18} />
              </button>
              <button
                onClick={() => onZapClick?.()}
                disabled={!assignee}
                className="zap-btn flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                title={assignee ? `Send a tip to ${assignee.displayName}` : 'Assign someone first'}
              >
                <Zap size={compact ? 14 : 16} />
                Zap
              </button>
              <button
                onClick={handleSubmit}
                disabled={!newComment.trim() || isSubmitting}
                className="btn-primary flex items-center gap-1 py-1.5 text-sm"
              >
                {isSubmitting ? (
                  <Loader2 size={compact ? 14 : 16} className="animate-spin" />
                ) : (
                  <Send size={compact ? 14 : 16} />
                )}
                {compact ? 'Send' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
