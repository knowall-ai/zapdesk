'use client';

import { format } from 'date-fns';
import { CalendarCheck } from 'lucide-react';
import type { User } from '@/types';
import Avatar from '../common/Avatar';

interface ApprovalDetailsProps {
  approvedBy?: User;
  /**
   * A Date, or the ISO string it becomes on its way through an API response:
   * the pages revive `createdAt` by hand, and this field is not worth a
   * revival at every one of them. Anything that is not a date shows nothing.
   */
  approvedDate?: Date | string;
}

/**
 * Who approved a work item, and when.
 *
 * Some processes require Approved By and Approved Date on every state but New
 * (#651). A drag asks for them when they are missing, but nothing showed them
 * once set, or showed that they were not -- so the only way to know why a
 * move would prompt was to open the item in Azure DevOps.
 *
 * Shows only what the item holds: a process without these fields, or an item
 * not yet approved, shows nothing rather than two empty rows. Shared by the
 * pop-up's sidebar and the full view so the two cannot drift.
 */
export default function ApprovalDetails({ approvedBy, approvedDate }: ApprovalDetailsProps) {
  const date = approvedDate ? new Date(approvedDate) : undefined;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : undefined;
  if (!approvedBy && !validDate) return null;

  return (
    <>
      {approvedBy && (
        <div>
          <span className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
            Approved By
          </span>
          <div className="flex items-center gap-2">
            <Avatar name={approvedBy.displayName} image={approvedBy.avatarUrl} size="sm" />
            <div className="min-w-0">
              <span className="block truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                {approvedBy.displayName}
              </span>
              {approvedBy.email && (
                <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  {approvedBy.email}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {validDate && (
        <div>
          <span className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
            Approved Date
          </span>
          <div className="flex items-center gap-2">
            <CalendarCheck size={14} style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {format(validDate, 'dd MMM yyyy')}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
