'use client';

import { format } from 'date-fns';
import { GitCommitHorizontal, Loader2 } from 'lucide-react';
import type { WorkItemUpdate } from '@/types';
import Avatar from '../common/Avatar';
import { DEFAULT_PRIORITY_LABELS } from '@/lib/priority';

interface TicketHistoryProps {
  updates: WorkItemUpdate[];
  loading: boolean;
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
  return DEFAULT_PRIORITY_LABELS[value] || value;
}

function formatFieldValue(field: string, value?: string): string {
  if (!value) return 'none';
  if (field === 'Microsoft.VSTS.Common.Priority') {
    return formatPriority(value) || value;
  }
  return value;
}

export default function TicketHistory({ updates, loading }: TicketHistoryProps) {
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
            <div className="flex-1 pb-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Avatar
                  name={update.revisedBy.displayName}
                  image={update.revisedBy.avatarUrl}
                  size="sm"
                />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {update.revisedBy.displayName}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {format(new Date(update.revisedDate), 'dd MMM yyyy, HH:mm')}
                </span>
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
                            className="inline-block rounded px-1.5 py-0.5 text-xs"
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
                          className="inline-block rounded px-1.5 py-0.5 text-xs line-through"
                          style={{
                            backgroundColor: 'var(--surface-hover)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {formatFieldValue(field, change.oldValue)}
                        </span>{' '}
                        to{' '}
                        <span
                          className="inline-block rounded px-1.5 py-0.5 text-xs"
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
