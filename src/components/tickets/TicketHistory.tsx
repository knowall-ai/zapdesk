'use client';

import { format, isValid } from 'date-fns';
import { GitCommitHorizontal, Loader2 } from 'lucide-react';
import type { WorkItemUpdate } from '@/types';
import Avatar from '../common/Avatar';

interface TicketHistoryProps {
  updates: WorkItemUpdate[];
  loading: boolean;
  /**
   * Who really raised a ticket that arrived by email (7770).
   *
   * Ingest writes to DevOps with the service PAT, so DevOps records the
   * account that owns it as the author of the creation -- which makes every
   * emailed ticket look as though one person raised it. The requester is
   * already resolved from the `email-from:` tag for the rest of the screen;
   * passing it here keeps the timeline telling the same story.
   *
   * Only the creation entry is reattributed. A later revision by that same
   * account is just as likely to be that person actually working the ticket,
   * and relabelling their real work as the customer would be a worse lie than
   * the one being fixed.
   */
  emailRequester?: { displayName: string; avatarUrl?: string };
}

// Friendly labels for Azure DevOps field reference names
const fieldLabels: Record<string, string> = {
  'System.State': 'State',
  'System.AssignedTo': 'Assignee',
  'System.Title': 'Title',
  'Microsoft.VSTS.Common.Priority': 'Priority',
  'System.Tags': 'Tags',
  'System.AreaPath': 'Area Path',
};

// Map priority numbers to labels
function formatPriority(value?: string): string | undefined {
  if (!value) return undefined;
  const priorityMap: Record<string, string> = {
    '1': 'Urgent',
    '2': 'High',
    '3': 'Normal',
    '4': 'Low',
  };
  return priorityMap[value] || value;
}

function formatFieldValue(field: string, value?: string): string {
  if (!value) return 'none';
  if (field === 'Microsoft.VSTS.Common.Priority') {
    return formatPriority(value) || value;
  }
  return value;
}

export default function TicketHistory({ updates, loading, emailRequester }: TicketHistoryProps) {
  if (loading) {
    return (
      <div
        className="flex items-center justify-center gap-2 py-8"
        style={{ color: 'var(--text-muted)' }}
      >
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading history...</span>
      </div>
    );
  }

  if (updates.length === 0) {
    return (
      <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No history available
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {updates.map((update, index) => {
        const fieldEntries = Object.entries(update.fields);
        const isCreation = update.id === 1;
        // The creation of an emailed ticket belongs to the customer, not to
        // the account whose token wrote it (7770).
        const viaEmail = isCreation && emailRequester !== undefined;
        const author = viaEmail ? emailRequester : update.revisedBy;
        const isLast = index === updates.length - 1;

        return (
          <div key={update.id} className="relative flex gap-3 pl-1">
            {/* Timeline line */}
            {!isLast && (
              <div
                className="absolute top-8 left-[13px] w-px"
                style={{
                  backgroundColor: 'var(--border)',
                  height: 'calc(100% - 8px)',
                }}
              />
            )}

            {/* Timeline dot */}
            <div className="relative z-10 flex-shrink-0 pt-1">
              <div
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
                style={{
                  backgroundColor: isCreation ? 'var(--primary)' : 'var(--surface-hover)',
                  color: isCreation ? 'white' : 'var(--text-muted)',
                }}
              >
                <GitCommitHorizontal size={10} />
              </div>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pb-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Avatar name={author.displayName} image={author.avatarUrl} size="sm" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {author.displayName}
                </span>
                {viaEmail && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    by email
                  </span>
                )}
                {isValid(new Date(update.revisedDate)) && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(update.revisedDate), 'dd MMM yyyy, HH:mm')}
                  </span>
                )}
              </div>

              {isCreation && fieldEntries.length === 0 ? (
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Created this work item
                </p>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {fieldEntries.map(([field, change]) => {
                    const label = fieldLabels[field] || field;
                    if (isCreation) {
                      return (
                        <p
                          key={field}
                          className="text-sm"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          Set <span style={{ color: 'var(--text-primary)' }}>{label}</span> to{' '}
                          <span
                            className="inline-block max-w-full rounded px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]"
                            style={{
                              backgroundColor: 'var(--surface-hover)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {formatFieldValue(field, change.newValue)}
                          </span>
                        </p>
                      );
                    }
                    return (
                      <p key={field} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Changed <span style={{ color: 'var(--text-primary)' }}>{label}</span> from{' '}
                        <span
                          className="inline-block max-w-full rounded px-1.5 py-0.5 text-xs [overflow-wrap:anywhere] line-through"
                          style={{
                            backgroundColor: 'var(--surface-hover)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {formatFieldValue(field, change.oldValue)}
                        </span>{' '}
                        to{' '}
                        <span
                          className="inline-block max-w-full rounded px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]"
                          style={{
                            backgroundColor: 'var(--surface-hover)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {formatFieldValue(field, change.newValue)}
                        </span>
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
