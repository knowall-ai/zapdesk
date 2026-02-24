'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft,
  ExternalLink,
  Clock,
  Building2,
  Send,
  Paperclip,
  ChevronDown,
  Search,
  Loader2,
  User as UserIcon,
  Zap,
  Info,
  X,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import type {
  Ticket,
  TicketComment,
  User,
  TicketPriority,
  WorkItemState,
  WorkItemUpdate,
  Attachment,
} from '@/types';
import { ALLOWED_ATTACHMENT_TYPES } from '@/types';
import { ensureActiveState } from '@/types';
import { highlightMentions } from '@/lib/mentions';
import { formatFileSize, validateFile } from '@/lib/attachment-utils';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';
import PriorityIndicator from '../common/PriorityIndicator';
import MentionInput from '../common/MentionInput';
import FileIcon from '../common/FileIcon';
import ZapDialog from './ZapDialog';
import TicketHistory from './TicketHistory';
import { useClickOutside } from '@/hooks';

type DetailTab = 'conversation' | 'history';

interface TicketDetailProps {
  ticket: Ticket;
  comments: TicketComment[];
  history?: WorkItemUpdate[];
  historyLoading?: boolean;
  onAddComment?: (comment: string) => Promise<void>;
  onStateChange?: (state: string) => Promise<void>;
  onAssigneeChange?: (assigneeId: string | null) => Promise<void>;
  onPriorityChange?: (priority: number) => Promise<void>;
  onUploadAttachment?: (file: File) => Promise<Attachment>;
  onRefreshTicket?: () => Promise<void>;
}

const priorityOptions: Array<{ value: number; label: TicketPriority }> = [
  { value: 1, label: 'Critical' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'Low' },
];

export default function TicketDetail({
  ticket,
  comments,
  history = [],
  historyLoading = false,
  onAddComment,
  onStateChange,
  onAssigneeChange,
  onPriorityChange,
  onUploadAttachment,
  onRefreshTicket,
}: TicketDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('conversation');
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isZapDialogOpen, setIsZapDialogOpen] = useState(false);
  const [isDetailsSidebarOpen, setIsDetailsSidebarOpen] = useState(false);

  // State editing
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState(false);
  const [availableStates, setAvailableStates] = useState<WorkItemState[]>([]);
  const [isLoadingStates, setIsLoadingStates] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);

  const handleZapSent = async (amount: number) => {
    if (onAddComment) {
      const zapMessage = `⚡ Sent a ${amount.toLocaleString()} sat zap to ${ticket.assignee?.displayName || 'the agent'} for great support!`;
      try {
        await onAddComment(zapMessage);
      } catch (err) {
        console.error('[TicketDetail] Failed to post zap comment:', err);
      }
    }
  };

  // Assignee editing state
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isUpdatingAssignee, setIsUpdatingAssignee] = useState(false);

  // Priority editing state
  const [isPriorityDropdownOpen, setIsPriorityDropdownOpen] = useState(false);
  const [isUpdatingPriority, setIsUpdatingPriority] = useState(false);

  // Attachment state
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Click-outside handlers for dropdowns
  const closeStateDropdown = useCallback(() => setIsStateDropdownOpen(false), []);
  const closeAssigneeDropdown = useCallback(() => {
    setIsAssigneeDropdownOpen(false);
    setAssigneeSearch('');
  }, []);
  const closePriorityDropdown = useCallback(() => setIsPriorityDropdownOpen(false), []);

  const stateDropdownRef = useClickOutside<HTMLDivElement>(closeStateDropdown, isStateDropdownOpen);
  const assigneeDropdownRef = useClickOutside<HTMLDivElement>(
    closeAssigneeDropdown,
    isAssigneeDropdownOpen
  );
  const priorityDropdownRef = useClickOutside<HTMLDivElement>(
    closePriorityDropdown,
    isPriorityDropdownOpen
  );

  // Fetch available states when state dropdown opens
  useEffect(() => {
    if (isStateDropdownOpen && availableStates.length === 0) {
      fetchAvailableStates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStateDropdownOpen]);

  const fetchAvailableStates = async () => {
    setIsLoadingStates(true);
    try {
      const response = await fetch('/api/devops/workitem-states');
      if (response.ok) {
        const data = await response.json();
        // Use shared utility to ensure "Active" state exists
        const states = ensureActiveState(data.allStates || []);
        setAvailableStates(states);
      }
    } catch (err) {
      console.error('Failed to fetch work item states:', err);
    } finally {
      setIsLoadingStates(false);
    }
  };

  const handleStateSelect = async (state: string) => {
    if (!onStateChange) return;
    setIsUpdatingState(true);
    try {
      await onStateChange(state);
      setIsStateDropdownOpen(false);
    } finally {
      setIsUpdatingState(false);
    }
  };

  // Fetch team members when assignee dropdown opens
  useEffect(() => {
    if (isAssigneeDropdownOpen && teamMembers.length === 0 && ticket.project) {
      fetchTeamMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssigneeDropdownOpen, ticket.project]);

  const fetchTeamMembers = async () => {
    if (!ticket.project) return;
    setIsLoadingMembers(true);
    try {
      const response = await fetch(
        `/api/devops/projects/${encodeURIComponent(ticket.project)}/members`
      );
      if (response.ok) {
        const data = await response.json();
        setTeamMembers(data.members || []);
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    } finally {
      setIsLoadingMembers(false);
    }
  };

  // Filter members based on search (exclude stakeholders)
  const filteredMembers = useMemo(() => {
    return teamMembers
      .filter((member) => {
        const isStakeholder =
          member.accessLevel?.toLowerCase().includes('stakeholder') ||
          member.licenseType?.toLowerCase().includes('stakeholder');
        return !isStakeholder;
      })
      .filter((member) => {
        if (!assigneeSearch) return true;
        const search = assigneeSearch.toLowerCase();
        return (
          member.displayName.toLowerCase().includes(search) ||
          member.email?.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [teamMembers, assigneeSearch]);

  const handleAssigneeSelect = async (memberId: string | null) => {
    if (!onAssigneeChange) return;
    setIsUpdatingAssignee(true);
    try {
      await onAssigneeChange(memberId);
      setIsAssigneeDropdownOpen(false);
      setAssigneeSearch('');
    } finally {
      setIsUpdatingAssignee(false);
    }
  };

  const handlePrioritySelect = async (priority: number) => {
    if (!onPriorityChange) return;
    setIsUpdatingPriority(true);
    try {
      await onPriorityChange(priority);
      setIsPriorityDropdownOpen(false);
    } finally {
      setIsUpdatingPriority(false);
    }
  };

  // File attachment handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setUploadError(null);
    const newFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validationError = validateFile(file);
      if (validationError) {
        setUploadError(validationError);
        continue;
      }
      newFiles.push(file);
    }

    if (newFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...newFiles]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitWithAttachments = async () => {
    if (!newComment.trim() && pendingFiles.length === 0) return;

    setIsSubmitting(true);
    setUploadError(null);

    try {
      // Upload all pending files first
      if (onUploadAttachment && pendingFiles.length > 0) {
        setIsUploadingFiles(true);
        for (const file of pendingFiles) {
          await onUploadAttachment(file);
        }
        setIsUploadingFiles(false);
        setPendingFiles([]);
      }

      // Then add comment if there is one
      if (newComment.trim() && onAddComment) {
        await onAddComment(newComment);
        setNewComment('');
      }

      // Refresh ticket once after all uploads and comment
      if (onRefreshTicket) {
        await onRefreshTicket();
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to upload files');
    } finally {
      setIsSubmitting(false);
      setIsUploadingFiles(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-3 flex items-center gap-4">
            <Link
              href="/tickets"
              className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <ArrowLeft size={20} />
            </Link>
            <h1 className="flex-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {ticket.title}
            </h1>
            {/* Mobile details button */}
            <button
              onClick={() => setIsDetailsSidebarOpen(true)}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)] lg:hidden"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Show ticket details"
            >
              <Info size={16} />
              Details
            </button>
            {/* Zap button moved to comment area */}
            <a
              href={ticket.devOpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)] sm:flex"
              style={{ color: 'var(--primary)' }}
            >
              View in DevOps <ExternalLink size={14} />
            </a>
          </div>

          <div className="flex items-center gap-4">
            {/* State dropdown */}
            <div className="relative" ref={stateDropdownRef}>
              <button
                onClick={() => setIsStateDropdownOpen(!isStateDropdownOpen)}
                disabled={!onStateChange || isUpdatingState}
                className="flex items-center gap-1 rounded transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ cursor: onStateChange ? 'pointer' : 'default' }}
              >
                {isUpdatingState ? (
                  <span
                    className="flex items-center gap-1 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Loader2 size={14} className="animate-spin" />
                    Updating...
                  </span>
                ) : (
                  <>
                    <StatusBadge status={ticket.devOpsState} />
                    {onStateChange && (
                      <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                    )}
                  </>
                )}
              </button>

              {/* State dropdown menu */}
              {isStateDropdownOpen && (
                <div
                  className="absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-md shadow-lg"
                  style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  {isLoadingStates ? (
                    <div
                      className="flex items-center justify-center gap-2 p-3"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Loader2 size={14} className="animate-spin" />
                      Loading...
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-auto py-1">
                      {availableStates.map((state) => (
                        <button
                          key={state.name}
                          onClick={() => handleStateSelect(state.name)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)] ${
                            state.name === ticket.devOpsState ? 'bg-[var(--surface-hover)]' : ''
                          }`}
                          style={{ cursor: 'pointer' }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: `#${state.color}` }}
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
              #{ticket.workItemId}
            </span>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              •
            </span>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {ticket.project}
            </span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b px-4" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => setActiveTab('conversation')}
            className="relative px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: activeTab === 'conversation' ? 'var(--primary)' : 'var(--text-muted)',
            }}
          >
            Conversation
            {activeTab === 'conversation' && (
              <span
                className="absolute right-0 bottom-0 left-0 h-0.5"
                style={{ backgroundColor: 'var(--primary)' }}
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className="relative px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: activeTab === 'history' ? 'var(--primary)' : 'var(--text-muted)',
            }}
          >
            History
            {activeTab === 'history' && (
              <span
                className="absolute right-0 bottom-0 left-0 h-0.5"
                style={{ backgroundColor: 'var(--primary)' }}
              />
            )}
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'conversation' ? (
          <>
            {/* Conversation */}
            <div className="flex-1 overflow-auto p-4">
              {/* Original ticket */}
              <div className="card mb-4 p-4">
                <div className="flex items-start gap-3">
                  <Avatar
                    name={ticket.requester.displayName}
                    image={ticket.requester.avatarUrl}
                    size="md"
                  />
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {ticket.requester.displayName}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {format(ticket.createdAt, 'dd MMM yyyy, HH:mm')}
                      </span>
                    </div>
                    <div
                      className="prose prose-sm prose-invert user-content max-w-none"
                      style={{ color: 'var(--text-secondary)' }}
                      dangerouslySetInnerHTML={{
                        __html: ticket.description || '<em>No description provided</em>',
                      }}
                    />
                    {/* Attachments */}
                    {ticket.attachments && ticket.attachments.length > 0 && (
                      <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                        <div
                          className="mb-2 flex items-center gap-1 text-xs"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <Paperclip size={12} />
                          <span>Attachments ({ticket.attachments.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {ticket.attachments.map((attachment) => (
                            <a
                              key={attachment.id}
                              href={attachment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                              style={{
                                backgroundColor: 'var(--surface)',
                                color: 'var(--text-secondary)',
                              }}
                              title={`Download ${attachment.fileName}`}
                            >
                              <FileIcon contentType={attachment.contentType} />
                              <span className="max-w-[150px] truncate">{attachment.fileName}</span>
                              {attachment.size > 0 && (
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  ({formatFileSize(attachment.size)})
                                </span>
                              )}
                              <Download size={12} style={{ color: 'var(--text-muted)' }} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Comments */}
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className={`card mb-4 p-4 ${comment.isInternal ? 'border-l-4' : ''}`}
                  style={comment.isInternal ? { borderLeftColor: 'var(--status-pending)' } : {}}
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={comment.author.displayName}
                      image={comment.author.avatarUrl}
                      size="md"
                    />
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
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
                        className="user-content text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                        dangerouslySetInnerHTML={{ __html: highlightMentions(comment.content) }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-auto p-4">
            <TicketHistory updates={history} loading={historyLoading} />
          </div>
        )}

        {/* Reply box */}
        <div
          className="border-t p-4"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            accept={ALLOWED_ATTACHMENT_TYPES.join(',')}
            className="hidden"
          />

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

          {/* Upload error */}
          {uploadError && (
            <div
              className="mb-3 flex items-center justify-between rounded-md p-2 text-sm"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
            >
              <span>{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="ml-2 hover:opacity-70">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Pending files */}
          {pendingFiles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                  style={{
                    backgroundColor: 'var(--surface-hover)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <FileIcon contentType={file.type} />
                  <span className="max-w-[150px] truncate">{file.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    ({formatFileSize(file.size)})
                  </span>
                  <button
                    onClick={() => removePendingFile(index)}
                    className="ml-1 hover:opacity-70"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <MentionInput
              value={newComment}
              onChange={setNewComment}
              placeholder="Type your reply... Use @ to mention team members"
              className="input min-h-[100px] w-full resize-none pr-24"
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded p-2 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: pendingFiles.length > 0 ? 'var(--primary)' : 'var(--text-muted)' }}
                title="Attach file"
                disabled={!onUploadAttachment}
              >
                <Paperclip size={18} />
              </button>
              {ticket.assignee && (
                <button
                  onClick={() => setIsZapDialogOpen(true)}
                  className="zap-btn flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                  title={`Send a tip to ${ticket.assignee.displayName}`}
                >
                  <Zap size={16} />
                  Zap
                </button>
              )}
              <button
                onClick={handleSubmitWithAttachments}
                disabled={(!newComment.trim() && pendingFiles.length === 0) || isSubmitting}
                className="btn-primary flex items-center gap-1 py-1.5 text-sm"
              >
                {isUploadingFiles ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Uploading...
                  </>
                ) : isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Submit
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {isDetailsSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsDetailsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-80 transform overflow-auto border-l transition-transform duration-300 ease-in-out ${
          isDetailsSidebarOpen ? 'translate-x-0' : 'translate-x-full'
        } lg:relative lg:z-auto lg:translate-x-0`}
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      >
        <div className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Ticket Details
            </h3>
            <button
              onClick={() => setIsDetailsSidebarOpen(false)}
              className="rounded-md p-1 transition-colors hover:bg-[var(--surface-hover)] lg:hidden"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close details"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-4">
            {/* Assignee - Editable */}
            <div className="relative" ref={assigneeDropdownRef}>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Assignee
              </label>
              <button
                onClick={() => setIsAssigneeDropdownOpen(!isAssigneeDropdownOpen)}
                disabled={!onAssigneeChange || isUpdatingAssignee}
                className="flex w-full items-center justify-between rounded p-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ cursor: onAssigneeChange ? 'pointer' : 'default' }}
              >
                {isUpdatingAssignee ? (
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Updating...
                    </span>
                  </div>
                ) : ticket.assignee ? (
                  <div className="flex items-center gap-2">
                    <Avatar
                      name={ticket.assignee.displayName}
                      image={ticket.assignee.avatarUrl}
                      size="sm"
                    />
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {ticket.assignee.displayName}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Unassigned
                  </span>
                )}
                {onAssigneeChange && (
                  <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                )}
              </button>

              {/* Assignee dropdown */}
              {isAssigneeDropdownOpen && (
                <div
                  className="absolute top-full left-0 z-50 mt-1 w-full rounded-md shadow-lg"
                  style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  {/* Search input */}
                  <div className="border-b p-2" style={{ borderColor: 'var(--border)' }}>
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute top-1/2 left-2 -translate-y-1/2"
                        style={{ color: 'var(--text-muted)' }}
                      />
                      <input
                        type="text"
                        placeholder="Search users..."
                        value={assigneeSearch}
                        onChange={(e) => setAssigneeSearch(e.target.value)}
                        className="input w-full pl-7 text-sm"
                        autoFocus
                      />
                    </div>
                  </div>
                  {/* Options */}
                  <div className="max-h-48 overflow-auto">
                    {/* Unassign option */}
                    <button
                      onClick={() => handleAssigneeSelect(null)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <UserIcon size={14} />
                      Unassigned
                    </button>
                    {isLoadingMembers ? (
                      <div
                        className="flex items-center justify-center gap-2 p-3"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Loader2 size={14} className="animate-spin" />
                        Loading...
                      </div>
                    ) : (
                      filteredMembers.map((member) => (
                        <button
                          key={member.id}
                          onClick={() => handleAssigneeSelect(member.email || member.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                          style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                        >
                          <Avatar name={member.displayName} image={member.avatarUrl} size="sm" />
                          {member.displayName}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Created By (Requester) */}
            <div>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Created By
              </label>
              <div className="flex items-center gap-2">
                <Avatar
                  name={ticket.requester.displayName}
                  image={ticket.requester.avatarUrl}
                  size="sm"
                />
                <div>
                  <span className="block text-sm" style={{ color: 'var(--text-primary)' }}>
                    {ticket.requester.displayName}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {ticket.requester.email}
                  </span>
                </div>
              </div>
            </div>

            {/* Priority - Editable */}
            <div className="relative" ref={priorityDropdownRef}>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Priority
              </label>
              <button
                onClick={() => setIsPriorityDropdownOpen(!isPriorityDropdownOpen)}
                disabled={!onPriorityChange || isUpdatingPriority}
                className="flex w-full items-center justify-between rounded p-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ cursor: onPriorityChange ? 'pointer' : 'default' }}
              >
                {isUpdatingPriority ? (
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Updating...
                    </span>
                  </div>
                ) : (
                  <PriorityIndicator priority={ticket.priority} showLabel />
                )}
                {onPriorityChange && (
                  <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                )}
              </button>

              {/* Priority dropdown */}
              {isPriorityDropdownOpen && (
                <div
                  className="absolute top-full left-0 z-50 mt-1 w-full rounded-md shadow-lg"
                  style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  {priorityOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handlePrioritySelect(option.value)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ cursor: 'pointer' }}
                    >
                      <PriorityIndicator priority={option.label} showLabel />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Project */}
            {ticket.project && (
              <div>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Project
                </label>
                <div className="flex items-center gap-2">
                  <Building2 size={16} style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {ticket.project}
                  </span>
                </div>
              </div>
            )}

            {/* Tags */}
            <div>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Tags
              </label>
              <div className="flex flex-wrap gap-1">
                {ticket.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded px-2 py-0.5 text-xs"
                    style={{
                      backgroundColor: 'var(--surface-hover)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Attachments */}
            {ticket.attachments && ticket.attachments.length > 0 && (
              <div>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Attachments ({ticket.attachments.length})
                </label>
                <div className="space-y-1">
                  {ticket.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ color: 'var(--text-secondary)' }}
                      title={`Download ${attachment.fileName}`}
                    >
                      <FileIcon contentType={attachment.contentType} />
                      <span className="flex-1 truncate">{attachment.fileName}</span>
                      <Download size={12} style={{ color: 'var(--text-muted)' }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Dates */}
            <div>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Created
              </label>
              <div className="flex items-center gap-2">
                <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {format(ticket.createdAt, 'dd MMM yyyy, HH:mm')}
                </span>
              </div>
            </div>

            <div>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Last Updated
              </label>
              <div className="flex items-center gap-2">
                <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {format(ticket.updatedAt, 'dd MMM yyyy, HH:mm')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zap Dialog */}
      {ticket.assignee && (
        <ZapDialog
          isOpen={isZapDialogOpen}
          onClose={() => setIsZapDialogOpen(false)}
          agent={ticket.assignee}
          ticketId={ticket.workItemId}
          onZapSent={handleZapSent}
        />
      )}
    </div>
  );
}
