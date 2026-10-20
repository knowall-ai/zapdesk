'use client';

import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { Send, Zap, Paperclip, Loader2, Lock, X } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import FileIcon from '@/components/common/FileIcon';
import UserHtml from '@/components/common/UserHtml';
import MentionInput from '@/components/common/MentionInput';
import {
  attachedFilesHtml,
  buildAttachmentProxyUrl,
  formatFileSize,
  validateFile,
} from '@/lib/attachment-utils';
import { ALLOWED_ATTACHMENT_TYPES } from '@/types';
import { useMentionableUsers } from '@/hooks/useMentionableUsers';
import type { TicketComment, User, Attachment } from '@/types';

interface CommentSectionProps {
  comments: TicketComment[];
  isLoading?: boolean;
  onAddComment?: (comment: string, isInternal?: boolean) => Promise<void>;
  onUploadAttachment?: (file: File) => Promise<Attachment>;
  assignee?: User | null;
  onZapClick?: () => void;
  compact?: boolean;
  // false → internal work item (no customer-facing copy). Defaults to true
  // so existing callers keep their ticket-style helper text.
  isTicket?: boolean;
}

/**
 * The comment thread on a ticket or work item, plus the composer beneath it.
 *
 * Comment bodies are Azure DevOps HTML and render through `UserHtml`, which
 * sanitises them and highlights `@mentions` (issue #413).
 */
export default function CommentSection({
  comments,
  isLoading = false,
  onAddComment,
  onUploadAttachment,
  assignee,
  onZapClick,
  compact = false,
  isTicket = true,
}: CommentSectionProps) {
  const mentionNames = useMentionableUsers();
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPastingImage, setIsPastingImage] = useState(false);
  // Public by default, as in the full view: the mitigation for a note sent to
  // the wrong audience is making the choice unmistakable, not flipping it.
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setUploadError(null);
    const accepted: File[] = [];
    for (const file of files) {
      const error = validateFile(file);
      if (error) setUploadError(error);
      else accepted.push(file);
    }
    if (accepted.length > 0) setPendingFiles((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if ((!newComment.trim() && pendingFiles.length === 0) || !onAddComment) return;
    setIsSubmitting(true);
    setUploadError(null);
    try {
      // Files go up first and are named in the comment, so a public reply
      // emails them to the customer (#7376).
      const uploaded: Attachment[] = [];
      if (onUploadAttachment) {
        for (const file of pendingFiles) uploaded.push(await onUploadAttachment(file));
      }
      setPendingFiles([]);
      const body = [newComment.trim(), attachedFilesHtml(uploaded)].filter(Boolean).join('\n');
      if (body) await onAddComment(body, isTicket ? isInternalNote : false);
      setNewComment('');
      setIsInternalNote(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to send');
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
        const imgSrc = attachmentId
          ? buildAttachmentProxyUrl(attachmentId, namedFile.name, org)
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
          No comments
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
                  <UserHtml
                    className={`user-content ${compact ? 'prose prose-sm prose-invert max-w-none text-sm' : 'text-sm'}`}
                    style={{ color: 'var(--text-secondary)' }}
                    html={comment.content}
                    mentions
                    mentionNames={mentionNames}
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
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            accept={ALLOWED_ATTACHMENT_TYPES.join(',')}
            className="hidden"
          />

          {/* Public reply vs internal note, in the dialog as well as the full
              view -- it used to exist only in the full view (#7375). */}
          {isTicket ? (
            <div className="mb-2">
              <div
                role="radiogroup"
                aria-label="Comment visibility"
                className="inline-flex rounded-md border p-0.5"
                style={{ borderColor: 'var(--border)' }}
              >
                {[
                  { internal: false, label: 'Public reply', Icon: Send },
                  { internal: true, label: 'Internal note', Icon: Lock },
                ].map(({ internal, label, Icon }) => {
                  const active = isInternalNote === internal;
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setIsInternalNote(internal)}
                      className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: active
                          ? internal
                            ? 'var(--warning-bg-hover)'
                            : 'var(--surface-hover)'
                          : 'transparent',
                        color: active
                          ? internal
                            ? 'var(--text-primary)'
                            : 'var(--primary)'
                          : 'var(--text-muted)',
                      }}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                {isInternalNote
                  ? 'Stays on the ticket. The requester is not emailed.'
                  : 'Visible to the requester in DevOps, and emailed if the ticket arrived by email.'}
              </p>
            </div>
          ) : (
            !compact && (
              <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Comments are visible in DevOps
              </p>
            )
          )}

          {uploadError && (
            <div
              className="mb-2 flex items-center justify-between rounded-md p-2 text-xs"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
            >
              <span>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="ml-2 hover:opacity-70"
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {pendingFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs"
                  style={{
                    backgroundColor: 'var(--surface-hover)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <FileIcon contentType={file.type} size={14} />
                  <span className="max-w-[150px] truncate">{file.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>({formatFileSize(file.size)})</span>
                  <button
                    type="button"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="hover:opacity-70"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
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
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!onUploadAttachment || isSubmitting}
                className="rounded p-2 transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: pendingFiles.length > 0 ? 'var(--primary)' : 'var(--text-muted)' }}
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
                disabled={(!newComment.trim() && pendingFiles.length === 0) || isSubmitting}
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
