'use client';

import { format } from 'date-fns';
import { Download } from 'lucide-react';
import FileIcon from '@/components/common/FileIcon';
import { attachmentDownloadUrl, formatFileSize } from '@/lib/attachment-utils';
import type { Attachment } from '@/types';

interface AttachmentListProps {
  attachments: Attachment[];
}

/** Dates arrive as strings over JSON; a missing or bad one is shown as nothing. */
function addedAt(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Files on a ticket, newest first, each with when it was added (#7726).
 *
 * Without a date there was no telling which file came with which message, and
 * several identically named screenshots were indistinguishable.
 *
 * Links download in place. Opening them sent the user to a new tab, and coming
 * back reloaded the ticket (#7719).
 */
export default function AttachmentList({ attachments }: AttachmentListProps) {
  const sorted = [...attachments].sort(
    (a, b) => (addedAt(b.createdAt)?.getTime() ?? 0) - (addedAt(a.createdAt)?.getTime() ?? 0)
  );

  return (
    <div className="space-y-1">
      {sorted.map((attachment) => {
        const when = addedAt(attachment.createdAt);
        return (
          <a
            key={attachment.id}
            href={attachmentDownloadUrl(attachment)}
            download={attachment.fileName}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-secondary)' }}
            title={`Download ${attachment.fileName}`}
          >
            <FileIcon contentType={attachment.contentType} />
            <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
            {attachment.size > 0 && (
              <span className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                {formatFileSize(attachment.size)}
              </span>
            )}
            {when && (
              <span
                className="shrink-0 text-xs whitespace-nowrap"
                style={{ color: 'var(--text-muted)' }}
                title={format(when, 'dd MMM yyyy, HH:mm:ss')}
              >
                {format(when, 'dd MMM yyyy, HH:mm')}
              </span>
            )}
            <Download size={12} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
          </a>
        );
      })}
    </div>
  );
}
