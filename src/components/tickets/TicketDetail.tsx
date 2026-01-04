'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, ExternalLink, Clock, Building2, Send, Paperclip } from 'lucide-react';
import Link from 'next/link';
import type { Ticket, TicketComment } from '@/types';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';
import PriorityIndicator from '../common/PriorityIndicator';
import SLABadge from '../common/SLABadge';

interface TicketDetailProps {
  ticket: Ticket;
  comments: TicketComment[];
  onAddComment?: (comment: string) => Promise<void>;
  onStatusChange?: (status: string) => Promise<void>;
}

export default function TicketDetail({
  ticket,
  comments,
  onAddComment,
  onStatusChange,
}: TicketDetailProps) {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
              <Avatar name={ticket.requester.displayName} size="md" />
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
                className="rounded p-2 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-muted)' }}
              >
                <Paperclip size={18} />
              </button>
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
            {/* Assignee */}
            <div>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Assignee
              </label>
              {ticket.assignee ? (
                <div className="flex items-center gap-2">
                  <Avatar name={ticket.assignee.displayName} size="sm" />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {ticket.assignee.displayName}
                  </span>
                </div>
              ) : (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Unassigned
                </span>
              )}
            </div>

            {/* Requester */}
            <div>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Requester
              </label>
              <div className="flex items-center gap-2">
                <Avatar name={ticket.requester.displayName} size="sm" />
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

            {/* Priority */}
            <div>
              <label
                className="mb-1 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Priority
              </label>
              <PriorityIndicator priority={ticket.priority} showLabel />
            </div>

            {/* SLA */}
            {ticket.slaInfo && (
              <div>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  SLA Status
                </label>
                <SLABadge slaInfo={ticket.slaInfo} variant="full" showLevel />
              </div>
            )}

            {/* Organization */}
            {ticket.organization && (
              <div>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Organization
                </label>
                <div className="flex items-center gap-2">
                  <Building2 size={16} style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {ticket.organization.name}
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
    </div>
  );
}
