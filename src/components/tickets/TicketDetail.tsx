'use client';

import { useState, useCallback } from 'react';
import { ArrowLeft, ExternalLink, ChevronDown, Loader2, Info, X } from 'lucide-react';
import Link from 'next/link';
import type { Ticket, TicketComment } from '@/types';
import { ticketToWorkItem } from '@/lib/devops';
import StatusBadge from '../common/StatusBadge';
import { useClickOutside } from '@/hooks';
import { useWorkItemActions } from '@/hooks/useWorkItemActions';
import WorkItemDetailContent from './WorkItemDetailContent';
import WorkItemDetailSidebar from './WorkItemDetailSidebar';

interface TicketDetailProps {
  ticket: Ticket;
  comments: TicketComment[];
  onAddComment?: (comment: string) => Promise<void>;
  onStateChange?: (state: string) => Promise<void>;
  onAssigneeChange?: (assigneeId: string | null) => Promise<void>;
  onPriorityChange?: (priority: number) => Promise<void>;
}

export default function TicketDetail({
  ticket,
  comments,
  onAddComment,
  onStateChange,
  onAssigneeChange,
  onPriorityChange,
}: TicketDetailProps) {
  const [isDetailsSidebarOpen, setIsDetailsSidebarOpen] = useState(false);

  const workItem = ticketToWorkItem(ticket);

  const actions = useWorkItemActions({
    project: ticket.project,
    onStateChange,
    onAssigneeChange,
    onPriorityChange,
  });

  // Click-outside for state dropdown in page header
  const closeStateDropdown = useCallback(() => actions.setIsStateDropdownOpen(false), [actions]);
  const stateDropdownRef = useClickOutside<HTMLDivElement>(
    closeStateDropdown,
    actions.isStateDropdownOpen
  );

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
                    <StatusBadge status={ticket.devOpsState} />
                    {onStateChange && (
                      <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                    )}
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
                            state.name === ticket.devOpsState ? 'bg-[var(--surface-hover)]' : ''
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
              #{ticket.workItemId}
            </span>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              &bull;
            </span>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {ticket.project}
            </span>
          </div>
        </div>

        {/* Content area */}
        <WorkItemDetailContent
          workItem={workItem}
          comments={comments}
          onAddComment={onAddComment}
          onZapSent={handleZapSent}
          showRequester
        />
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
        style={{
          borderColor: 'var(--border)',
          backgroundColor: 'var(--surface)',
        }}
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

          <WorkItemDetailSidebar
            workItem={workItem}
            actions={actions}
            showRequester
            canEditAssignee={!!onAssigneeChange}
            canEditPriority={!!onPriorityChange}
          />
        </div>
      </div>
    </div>
  );
}
