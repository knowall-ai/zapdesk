'use client';

import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import Link from 'next/link';
import type { Ticket, TicketComment, User, TicketPriority } from '@/types';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';
import PriorityIndicator from '../common/PriorityIndicator';
import ZapDialog from './ZapDialog';

interface TicketDetailProps {
  ticket: Ticket;
  comments: TicketComment[];
  onAddComment?: (comment: string) => Promise<void>;
  onStatusChange?: (status: string) => Promise<void>;
  onAssigneeChange?: (assigneeId: string | null) => Promise<void>;
  onPriorityChange?: (priority: number) => Promise<void>;
}

const priorityOptions: Array<{ value: number; label: TicketPriority }> = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
];

export default function TicketDetail({
  ticket,
  comments,
  onAddComment,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStatusChange: _onStatusChange,
  onAssigneeChange,
  onPriorityChange,
}: TicketDetailProps) {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isZapDialogOpen, setIsZapDialogOpen] = useState(false);

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

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !onAddComment) return;

    setIsSubmitting(true);
    try {
      await onAddComment(newComment);
      setNewComment('');
    } finally {
      setIsSubmitting(false);
    }
  };

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
            {/* Zap button moved to comment area */}
            <a
              href={ticket.devOpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--primary)' }}
            >
              View in DevOps <ExternalLink size={14} />
            </a>
          </div>

          <div className="flex items-center gap-4">
            <StatusBadge status={ticket.status} />
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
                  className="prose prose-sm prose-invert max-w-none"
                  style={{ color: 'var(--text-secondary)' }}
                  dangerouslySetInnerHTML={{
                    __html: ticket.description || '<em>No description provided</em>',
                  }}
                />
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
                <Avatar name={comment.author.displayName} size="md" />
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
                    className="text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                    dangerouslySetInnerHTML={{ __html: comment.content }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Reply box */}
        <div
          className="border-t p-4"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm text-white">
              Public reply
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              All comments are visible to customers in DevOps
            </span>
          </div>

          <div className="relative">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Type your reply..."
              className="input min-h-[100px] w-full resize-none pr-24"
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <button
                onClick={() => alert('Attachments not yet implemented')}
                className="rounded p-2 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-muted)' }}
                title="Attach file"
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
                onClick={handleSubmitComment}
                disabled={!newComment.trim() || isSubmitting}
                className="btn-primary flex items-center gap-1 py-1.5 text-sm"
              >
                <Send size={16} />
                {isSubmitting ? 'Sending...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div
        className="w-80 overflow-auto border-l"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      >
        <div className="p-4">
          <h3 className="mb-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Ticket Details
          </h3>

          <div className="space-y-4">
            {/* Assignee - Editable */}
            <div className="relative">
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
            <div className="relative">
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
