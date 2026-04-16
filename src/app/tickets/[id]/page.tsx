'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { TicketDetail } from '@/components/tickets';
import { useOrganization } from '@/components/providers/OrganizationProvider';
import type { Ticket, TicketComment, Attachment, WorkItemUpdate } from '@/types';

export default function TicketDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const ticketId = params.id as string;
  const { selectedOrganization } = useOrganization();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [history, setHistory] = useState<WorkItemUpdate[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  // Helper to build headers with org
  const orgHeaders = useCallback(
    (extra?: Record<string, string>) => ({
      ...(selectedOrganization && { 'x-devops-org': selectedOrganization.accountName }),
      ...extra,
    }),
    [selectedOrganization]
  );

  // Reset state when navigating to a different ticket
  useEffect(() => {
    setTicket(null);
    setComments([]);
    setHistory([]);
    setLoading(true);
  }, [ticketId]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchTicket = useCallback(async () => {
    if (!selectedOrganization) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        headers: orgHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setTicket({
          ...data.ticket,
          createdAt: new Date(data.ticket.createdAt),
          updatedAt: new Date(data.ticket.updatedAt),
        });
        setComments(
          data.comments
            .map((c: TicketComment & { createdAt: string }) => ({
              ...c,
              createdAt: new Date(c.createdAt),
            }))
            // Sort by date ascending (oldest first, newest at bottom)
            .sort(
              (a: TicketComment, b: TicketComment) => a.createdAt.getTime() - b.createdAt.getTime()
            )
        );
      } else {
        router.push('/tickets');
      }
    } catch (error) {
      console.error('Failed to fetch ticket:', error);
      router.push('/tickets');
    } finally {
      setLoading(false);
    }
  }, [ticketId, router, selectedOrganization, orgHeaders]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/history`);
      if (response.ok) {
        const data = await response.json();
        setHistory(
          (data.updates || []).map((u: WorkItemUpdate & { revisedDate: string }) => ({
            ...u,
            revisedDate: new Date(u.revisedDate),
          }))
        );
      }
    } catch (error) {
      console.error('Failed to fetch ticket history:', error);
    } finally {
      setHistoryLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (session?.accessToken && ticketId && selectedOrganization) {
      fetchTicket();
      fetchHistory();
    }
  }, [session, ticketId, fetchTicket, fetchHistory, selectedOrganization]);

  // Re-verify ticket exists when user tabs back (e.g., after deleting in DevOps)
  useEffect(() => {
    if (!ticket || !selectedOrganization) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(`/api/devops/tickets/${ticketId}/exists`, {
          headers: orgHeaders(),
        });
        if (response.status === 404) {
          router.push('/tickets');
        }
        // Ignore other errors (auth, throttling, 5xx) — don't redirect on transient failures
      } catch {
        // Network error — don't redirect on transient failures
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [ticket, selectedOrganization, ticketId, orgHeaders, router]);

  const handleAddComment = async (comment: string) => {
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ comment }),
      });

      if (response.ok) {
        await fetchTicket();
      } else {
        toast.error('Failed to add comment');
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
      toast.error('Failed to add comment');
    }
  };

  const handleStateChange = async (newState: string) => {
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/state`, {
        method: 'PATCH',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ state: newState }),
      });

      if (response.ok) {
        await fetchTicket();
        toast.success(`Status updated to "${newState}"`);
      } else {
        toast.error('Failed to update status');
      }
    } catch (error) {
      console.error('Failed to update state:', error);
      toast.error('Failed to update status');
    }
  };

  const handleAssigneeChange = async (assigneeId: string | null) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          assignee: assigneeId,
          project: ticket.project,
        }),
      });

      if (response.ok) {
        await fetchTicket();
        toast.success('Assignee updated');
      } else {
        toast.error('Failed to update assignee');
      }
    } catch (error) {
      console.error('Failed to update assignee:', error);
      toast.error('Failed to update assignee');
    }
  };

  const handlePriorityChange = async (priority: number) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          priority,
          project: ticket.project,
        }),
      });

      if (response.ok) {
        await fetchTicket();
        toast.success('Priority updated');
      } else {
        toast.error('Failed to update priority');
      }
    } catch (error) {
      console.error('Failed to update priority:', error);
      toast.error('Failed to update priority');
    }
  };

  const handleTypeChange = async (newType: string, additionalFields?: Record<string, string>) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/type`, {
        method: 'PATCH',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type: newType, project: ticket.project, additionalFields }),
      });

      if (response.ok) {
        await fetchTicket();
        toast.success(`Type changed to "${newType}"`);
      } else {
        toast.error('Failed to change work item type');
      }
    } catch (error) {
      console.error('Failed to change work item type:', error);
      toast.error('Failed to change work item type');
    }
  };

  const handleDescriptionChange = async (description: string) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          description,
          project: ticket.project,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update description');
      }

      await fetchTicket();
      toast.success('Description updated');
    } catch (error) {
      console.error('Failed to update description:', error);
      toast.error('Failed to update description');
      throw error;
    }
  };

  const handleTagsChange = async (tags: string[]) => {
    if (!ticket) return;
    const response = await fetch(`/api/devops/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: orgHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tags, project: ticket.project }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast.error(data.error || 'Failed to update tags');
      throw new Error(data.error || 'Failed to update tags');
    }
    await fetchTicket();
    toast.success('Tags updated');
  };

  const handleResolutionChange = async (resolution: string) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          resolution,
          project: ticket.project,
          workItemType: ticket.workItemType,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update resolution');
      }

      await fetchTicket();
      toast.success('Resolution updated');
    } catch (error) {
      console.error('Failed to update resolution:', error);
      toast.error('Failed to update resolution');
      throw error;
    }
  };

  const handleMitigationChange = async (mitigation: string) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: orgHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mitigation,
          project: ticket.project,
          workItemType: ticket.workItemType,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update mitigation');
      }

      await fetchTicket();
      toast.success('Mitigation updated');
    } catch (error) {
      console.error('Failed to update mitigation:', error);
      toast.error('Failed to update mitigation');
      throw error;
    }
  };

  const handleUploadAttachment = async (file: File): Promise<Attachment> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/api/devops/tickets/${ticketId}/attachments`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to upload attachment');
    }

    const data = await response.json();
    return data.attachment;
  };

  if (status === 'loading' || loading) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </MainLayout>
    );
  }

  if (!session || !ticket) {
    return null;
  }

  return (
    <MainLayout>
      <TicketDetail
        key={ticketId}
        ticket={ticket}
        comments={comments}
        history={history}
        historyLoading={historyLoading}
        onAddComment={handleAddComment}
        onStateChange={handleStateChange}
        onAssigneeChange={handleAssigneeChange}
        onPriorityChange={handlePriorityChange}
        onTypeChange={handleTypeChange}
        onTagsChange={handleTagsChange}
        onDescriptionChange={handleDescriptionChange}
        onResolutionChange={handleResolutionChange}
        onMitigationChange={handleMitigationChange}
        onUploadAttachment={handleUploadAttachment}
        onRefreshTicket={fetchTicket}
      />
    </MainLayout>
  );
}
