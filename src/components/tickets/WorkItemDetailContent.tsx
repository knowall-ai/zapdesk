'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import type { WorkItem, TicketComment } from '@/types';
import Avatar from '../common/Avatar';
import CommentSection from './CommentSection';
import ZapDialog from './ZapDialog';

interface WorkItemDetailContentProps {
  workItem: WorkItem;
  comments: TicketComment[];
  isLoadingComments?: boolean;
  onAddComment?: (comment: string) => Promise<void>;
  onUpdate?: (updates: { title?: string; description?: string }) => Promise<void>;
  onZapSent?: (amount: number) => void;
  showRequester?: boolean;
  showEffortTracking?: boolean;
  compact?: boolean;
}

const formatHours = (hours: number) => {
  if (hours === 0) return '0';
  if (hours < 1) return hours.toFixed(1);
  return Math.round(hours).toString();
};

export default function WorkItemDetailContent({
  workItem,
  comments,
  isLoadingComments = false,
  onAddComment,
  onUpdate,
  onZapSent,
  showRequester = false,
  showEffortTracking = false,
  compact = false,
}: WorkItemDetailContentProps) {
  const [isZapDialogOpen, setIsZapDialogOpen] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleStartEdit = () => {
    setEditTitle(workItem.title);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = workItem.description || '';
    setEditDescription(tempDiv.textContent || tempDiv.innerText || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditTitle('');
    setEditDescription('');
  };

  const handleSaveEdit = async () => {
    if (!onUpdate) return;
    setIsSaving(true);
    try {
      const updates: { title?: string; description?: string } = {};
      if (editTitle !== workItem.title) {
        updates.title = editTitle;
      }
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = workItem.description || '';
      const originalText = tempDiv.textContent || tempDiv.innerText || '';
      if (editDescription !== originalText) {
        updates.description = editDescription;
      }
      if (Object.keys(updates).length > 0) {
        await onUpdate(updates);
      }
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save changes:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleZapSent = async (amount: number) => {
    if (onZapSent) {
      onZapSent(amount);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Title with edit controls */}
      <div className="mb-4 flex items-start gap-2">
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="input w-full text-xl font-semibold"
            placeholder="Title"
            autoFocus
          />
        ) : (
          <h2 className="flex-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {workItem.title}
          </h2>
        )}
        {onUpdate && (
          <div className="flex shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancelEdit}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ color: 'var(--text-muted)' }}
                  title="Cancel editing"
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editTitle.trim()}
                  className="btn-primary flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-50"
                  title="Save changes"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Save
                </button>
              </>
            ) : (
              <button
                onClick={handleStartEdit}
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-secondary)' }}
                title="Edit title and description"
              >
                <Pencil size={14} />
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {/* Original ticket card (requester info for page view) */}
      {showRequester && workItem.requester && (
        <div className="card mb-4 p-4">
          <div className="flex items-start gap-3">
            <Avatar
              name={workItem.requester.displayName}
              image={workItem.requester.avatarUrl}
              size="md"
            />
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {workItem.requester.displayName}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {format(workItem.createdAt, 'dd MMM yyyy, HH:mm')}
                </span>
              </div>
              <div
                className="prose prose-sm prose-invert user-content max-w-none"
                style={{ color: 'var(--text-secondary)' }}
                dangerouslySetInnerHTML={{
                  __html: workItem.description || '<em>No description provided</em>',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Description card (for dialog view without requester) */}
      {!showRequester && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Description
          </h3>
          {isEditing ? (
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="input min-h-[150px] w-full resize-y text-sm"
              placeholder="Add a description..."
            />
          ) : workItem.description ? (
            <div
              className="prose prose-sm prose-invert user-content max-w-none"
              style={{ color: 'var(--text-secondary)' }}
              dangerouslySetInnerHTML={{ __html: workItem.description }}
            />
          ) : (
            <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
              No description provided
            </p>
          )}
        </div>
      )}

      {/* Effort tracking */}
      {showEffortTracking &&
        (workItem.completedWork > 0 ||
          workItem.remainingWork > 0 ||
          workItem.originalEstimate > 0) && (
          <div className="card mt-4 p-4">
            <h3 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
              Effort Tracking
            </h3>
            <div className="flex gap-6">
              <div>
                <span className="block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Completed
                </span>
                <span className="text-lg font-bold" style={{ color: 'var(--primary)' }}>
                  {formatHours(workItem.completedWork)}h
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Remaining
                </span>
                <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {formatHours(workItem.remainingWork)}h
                </span>
              </div>
              {workItem.originalEstimate > 0 && (
                <div>
                  <span className="block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                    Estimate
                  </span>
                  <span className="text-lg font-bold" style={{ color: 'var(--text-secondary)' }}>
                    {formatHours(workItem.originalEstimate)}h
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

      {/* Comments */}
      {compact ? (
        <div className="card mt-4 p-4">
          <h3 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Comments
          </h3>
          <CommentSection
            comments={comments}
            isLoading={isLoadingComments}
            onAddComment={onAddComment}
            assignee={workItem.assignee}
            onZapClick={() => setIsZapDialogOpen(true)}
            compact
          />
        </div>
      ) : (
        <CommentSection
          comments={comments}
          isLoading={isLoadingComments}
          onAddComment={onAddComment}
          assignee={workItem.assignee}
          onZapClick={() => setIsZapDialogOpen(true)}
        />
      )}

      {/* Zap Dialog */}
      {workItem.assignee && isZapDialogOpen && (
        <ZapDialog
          isOpen={isZapDialogOpen}
          onClose={() => setIsZapDialogOpen(false)}
          agent={workItem.assignee}
          ticketId={workItem.id}
          onZapSent={handleZapSent}
        />
      )}
    </div>
  );
}
