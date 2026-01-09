'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { TicketDetail } from '@/components/tickets';
import type { Ticket, TicketComment } from '@/types';

export default function TicketDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const ticketId = params.id as string;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loading, setLoading] = useState(true);

  // Reset state when navigating to a different ticket
  useEffect(() => {
    setTicket(null);
    setComments([]);
    setLoading(true);
  }, [ticketId]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchTicket = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`);
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
  }, [ticketId, router]);

  useEffect(() => {
    if (session?.accessToken && ticketId) {
      fetchTicket();
    }
  }, [session, ticketId, fetchTicket]);

  const handleAddComment = async (comment: string) => {
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });

      if (response.ok) {
        await fetchTicket(); // Refresh comments
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
    }
  };

  const handleStateChange = async (newState: string) => {
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });

      if (response.ok) {
        await fetchTicket(); // Refresh ticket
      }
    } catch (error) {
      console.error('Failed to update state:', error);
    }
  };

  const handleAssigneeChange = async (assigneeId: string | null) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee: assigneeId,
          project: ticket.project,
        }),
      });

      if (response.ok) {
        await fetchTicket(); // Refresh ticket
      }
    } catch (error) {
      console.error('Failed to update assignee:', error);
    }
  };

  const handlePriorityChange = async (priority: number) => {
    if (!ticket) return;
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priority,
          project: ticket.project,
        }),
      });

      if (response.ok) {
        await fetchTicket(); // Refresh ticket
      }
    } catch (error) {
      console.error('Failed to update priority:', error);
    }
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
        onAddComment={handleAddComment}
        onStateChange={handleStateChange}
        onAssigneeChange={handleAssigneeChange}
        onPriorityChange={handlePriorityChange}
      />
    </MainLayout>
  );
}
