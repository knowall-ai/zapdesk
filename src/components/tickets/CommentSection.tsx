'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Send, Zap, Paperclip, Loader2 } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import MentionInput from '@/components/common/MentionInput';
import type { TicketComment, User, Attachment } from '@/types';

interface CommentSectionProps {
  comments: TicketComment[];
  isLoading?: boolean;
  onAddComment?: (comment: string) => Promise<void>;
  onUploadAttachment?: (file: File) => Promise<Attachment>;
  assignee?: User | null;
  onZapClick?: () => void;
  compact?: boolean;
}

export default function CommentSection({
  comments,
  isLoading = false,
  onAddComment,
  onUploadAttachment,
  assignee,
  onZapClick,
  compact = false,
}: CommentSectionProps) {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPastingImage, setIsPastingImage] = useState(false);

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

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!onUploadAttachment) return;

    const imageFiles: File[] = [];

    if (e.clipboardData?.files) {
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        const file = e.clipboardData.files[i];
        if (file.type.startsWith('image/')) imageFiles.push(file);
      }
    }

    if (imageFiles.length === 0 && e.clipboardData?.items) {
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length === 0) return;

    e.preventDefault();
    setIsPastingImage(true);

    try {
      for (const file of imageFiles) {
        const ext = file.type.split('/')[1] || 'png';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const namedFile = new File([file], `pasted-image-${timestamp}.${ext}`, {
          type: file.type,
        });
        const attachment = await onUploadAttachment(namedFile);
        const idMatch = attachment.url?.match(/attachments\/([a-f0-9-]+)/i);
        const orgMatch = attachment.url?.match(/dev\.azure\.com\/([^/]+)/);
        const attachmentId = idMatch ? idMatch[1] : null;
        const org = orgMatch ? orgMatch[1] : '';
        const params = new URLSearchParams({
          fileName: namedFile.name,
          ...(org && { org }),
        });
        const imgSrc = attachmentId
          ? `/api/devops/attachments/${attachmentId}?${params.toString()}`
          : attachment.url;
        const imgHtml = `<img src="${imgSrc}" alt="${namedFile.name}" />`;
        setNewComment((prev) => (prev ? `${prev}\n${imgHtml}` : imgHtml));
      }
    } catch (error) {
      console.error('Failed to upload pasted image:', error);
    } finally {
      setIsPastingImage(false);
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
            <MentionInput
              value={newComment}
              onChange={setNewComment}
              onPaste={onUploadAttachment ? handlePaste : undefined}
              placeholder={
                compact
                  ? 'Add a comment... Paste images with Ctrl+V'
                  : 'Type your reply... Paste images with Ctrl+V'
              }
              className={`input w-full resize-none ${compact ? 'min-h-[60px] text-sm' : 'min-h-[100px]'}`}
              disabled={isSubmitting || isPastingImage}
            />
            {isPastingImage && (
              <div
                className="mt-1 flex items-center gap-2 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                <Loader2 size={12} className="animate-spin" />
                Uploading pasted image...
              </div>
            )}
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                onClick={() =>
                  alert('Use Ctrl+V to paste images, or use the full view for file attachments')
                }
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
