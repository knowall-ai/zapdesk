'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, ChevronDown, Loader2, Maximize2 } from 'lucide-react';
import type { WorkItem, TicketComment, Attachment } from '@/types';
import StatusBadge from '../common/StatusBadge';
import TicketDialogShell from './TicketDialogShell';
import { useWorkItemActions } from '@/hooks/useWorkItemActions';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';
import WorkItemDetailContent from './WorkItemDetailContent';
import WorkItemDetailSidebar from './WorkItemDetailSidebar';
import TypeChangeRequiredFields from './TypeChangeRequiredFields';

interface WorkItemDetailDialogProps {
  workItem: WorkItem | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted?: (workItemId: number) => void;
  onStateChange?: (workItemId: number, state: string) => Promise<void>;
  onAssigneeChange?: (workItemId: number, assigneeId: string | null) => Promise<void>;
  onPriorityChange?: (workItemId: number, priority: number) => Promise<void>;
  onTypeChange?: (
    workItemId: number,
    type: string,
    additionalFields?: Record<string, string>
  ) => Promise<void>;
  onUpdate?: (
    workItemId: number,
    updates: { title?: string; description?: string; resolution?: string }
  ) => Promise<void>;
}

export default function WorkItemDetailDialog({
  workItem,
  isOpen,
  onClose,
  onDeleted,
  onStateChange,
  onAssigneeChange,
  onPriorityChange,
  onTypeChange,
  onUpdate,
}: WorkItemDetailDialogProps) {
  const router = useRouter();
  const { fetchDevOps, hasOrganization } = useDevOpsApi();

  // Comments state (dialog fetches its own comments)
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);

  // Bind workItemId into callbacks for the hook
  const boundStateChange = useCallback(
    async (state: string) => {
      if (onStateChange && workItem) {
        await onStateChange(workItem.id, state);
      }
    },
    [onStateChange, workItem]
  );

  const boundAssigneeChange = useCallback(
    async (assigneeId: string | null) => {
      if (onAssigneeChange && workItem) {
        await onAssigneeChange(workItem.id, assigneeId);
      }
    },
    [onAssigneeChange, workItem]
  );

  const boundPriorityChange = useCallback(
    async (priority: number) => {
      if (onPriorityChange && workItem) {
        await onPriorityChange(workItem.id, priority);
      }
    },
    [onPriorityChange, workItem]
  );

  const boundTypeChange = useCallback(
    async (type: string, additionalFields?: Record<string, string>) => {
      if (onTypeChange && workItem) {
        await onTypeChange(workItem.id, type, additionalFields);
      }
    },
    [onTypeChange, workItem]
  );

  const actions = useWorkItemActions({
    project: workItem?.project,
    workItemType: workItem?.workItemType,
    onStateChange: onStateChange ? boundStateChange : undefined,
    onAssigneeChange: onAssigneeChange ? boundAssigneeChange : undefined,
    onPriorityChange: onPriorityChange ? boundPriorityChange : undefined,
    onTypeChange: onTypeChange ? boundTypeChange : undefined,
  });

  // Fetch comments when dialog opens
  const fetchComments = useCallback(async () => {
    if (!workItem?.project || !hasOrganization) return;
    setIsLoadingComments(true);
    try {
      const response = await fetchDevOps(`/api/devops/tickets/${workItem.id}/comments`);
      if (response.ok) {
        const data = await response.json();
        setComments(
          (data.comments || [])
            .map((c: TicketComment & { createdAt: string }) => ({
              ...c,
              createdAt: new Date(c.createdAt),
            }))
            .sort(
              (a: TicketComment, b: TicketComment) => a.createdAt.getTime() - b.createdAt.getTime()
            )
        );
      }
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setIsLoadingComments(false);
    }
  }, [workItem?.id, workItem?.project, fetchDevOps, hasOrganization]);

  const handleAddComment = useCallback(
    async (comment: string) => {
      if (!workItem || !hasOrganization) return;
      const response = await fetchDevOps(`/api/devops/tickets/${workItem.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      if (response.ok) {
        await fetchComments();
      }
    },
    [workItem, fetchComments, fetchDevOps, hasOrganization]
  );

  const handleUploadAttachment = useCallback(
    async (file: File): Promise<Attachment> => {
      if (!workItem) throw new Error('No work item');
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetchDevOps(`/api/devops/tickets/${workItem.id}/attachments`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to upload attachment');
      }
      const data = await response.json();
      return data.attachment;
    },
    [workItem, fetchDevOps]
  );

  const handleUpdate = useCallback(
    async (updates: { title?: string; description?: string; resolution?: string }) => {
      if (!workItem || !onUpdate) return;
      await onUpdate(workItem.id, updates);
    },
    [workItem, onUpdate]
  );

  // Reset state when dialog closes or workItem changes
  useEffect(() => {
    if (!isOpen || !workItem) {
      actions.resetAll();
      setComments([]);
    }
    actions.resetStates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workItem]);

  // Fetch comments when dialog opens with a work item
  useEffect(() => {
    if (isOpen && workItem) {
      fetchComments();
    }
  }, [isOpen, workItem, fetchComments]);

  // Re-verify ticket exists when user tabs back (e.g., after deleting in DevOps)
  useEffect(() => {
    if (!isOpen || !workItem || !hasOrganization) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetchDevOps(`/api/devops/tickets/${workItem.id}/exists`);
        if (response.status === 404) {
          onClose();
          onDeleted?.(workItem.id);
        }
        // Ignore other errors (auth, throttling, 5xx) — don't close on transient failures
      } catch {
        // Network error — don't close on transient failures
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isOpen, workItem, fetchDevOps, hasOrganization, onClose, onDeleted]);

  if (!workItem) return null;

  const headerLeft = (
    <>
      {/* State dropdown */}
      <div className="relative">
        <button
          onClick={() => actions.setIsStateDropdownOpen(!actions.isStateDropdownOpen)}
          disabled={!onStateChange || actions.isUpdatingState}
          className="flex items-center gap-1 rounded transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ cursor: onStateChange ? 'pointer' : 'default' }}
        >
          {actions.isUpdatingState ? (
            <span
              className="flex items-center gap-1 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              <Loader2 size={14} className="animate-spin" />
              Updating...
            </span>
          ) : (
            <>
              <StatusBadge status={workItem.state} />
              {onStateChange && <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
            </>
          )}
        </button>

        {/* State dropdown menu */}
        {actions.isStateDropdownOpen && (
          <div
            className="absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-md shadow-lg"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            {actions.isLoadingStates ? (
              <div
                className="flex items-center justify-center gap-2 p-3"
                style={{ color: 'var(--text-muted)' }}
              >
                <Loader2 size={14} className="animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="max-h-64 overflow-auto py-1">
                {actions.availableStates.map((state) => (
                  <button
                    key={state.name}
                    onClick={() => actions.handleStateSelect(state.name)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)] ${
                      state.name === workItem.state ? 'bg-[var(--surface-hover)]' : ''
                    }`}
                    style={{ cursor: 'pointer' }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: `#${state.color}`,
                      }}
                    />
                    <span style={{ color: 'var(--text-primary)' }}>{state.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
        #{workItem.id}
      </span>
      <span
        className="rounded px-2 py-0.5 text-xs"
        style={{
          backgroundColor: 'var(--surface)',
          color: 'var(--text-secondary)',
        }}
      >
        {workItem.workItemType}
      </span>
    </>
  );

  const headerRight = (
    <>
      <button
        onClick={() => {
          router.push(`/tickets/${workItem.id}`);
          onClose();
        }}
        className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
        style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
        title="Open full page"
      >
        <Maximize2 size={14} />
        Full View
      </button>
      <a
        href={workItem.devOpsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
        style={{ color: 'var(--primary)' }}
      >
        DevOps <ExternalLink size={14} />
      </a>
    </>
  );

  const sidebar = (
    <div className="p-4">
      <h3 className="mb-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        Details
      </h3>
      <WorkItemDetailSidebar
        workItem={workItem}
        actions={actions}
        showAreaPath
        showEffortHours
        canEditAssignee={!!onAssigneeChange}
        canEditPriority={!!onPriorityChange}
        canEditType={!!onTypeChange}
      />
    </div>
  );

  return (
    <>
      <TicketDialogShell
        isOpen={isOpen}
        onClose={onClose}
        headerLeft={headerLeft}
        headerRight={headerRight}
        sidebar={sidebar}
      >
        <WorkItemDetailContent
          workItem={workItem}
          comments={comments}
          isLoadingComments={isLoadingComments}
          onAddComment={handleAddComment}
          onUploadAttachment={handleUploadAttachment}
          onUpdate={onUpdate ? handleUpdate : undefined}
          showEffortTracking
          compact
        />
      </TicketDialogShell>

      {/* Required fields modal for type change */}
      {actions.pendingTypeChange && (
        <TypeChangeRequiredFields
          targetType={actions.pendingTypeChange.type}
          requiredFields={actions.pendingTypeChange.requiredFields}
          fieldValues={actions.pendingTypeFieldValues}
          onFieldChange={actions.setPendingTypeFieldValue}
          onConfirm={actions.confirmPendingTypeChange}
          onCancel={actions.cancelPendingTypeChange}
          isUpdating={actions.isUpdatingType}
          members={actions.pendingTypeMembers}
          memberSearch={actions.pendingTypeMemberSearch}
          onMemberSearchChange={actions.setPendingTypeMemberSearch}
          filteredMembers={actions.filteredPendingTypeMembers}
        />
      )}
    </>
  );
}
