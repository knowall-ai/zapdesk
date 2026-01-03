'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
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
        setComments(data.comments.map((c: TicketComment & { createdAt: string }) => ({
          ...c,
          createdAt: new Date(c.createdAt),
        })));
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

  const handleStatusChange = async (newStatus: string) => {
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        await fetchTicket(); // Refresh ticket
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--primary)' }} />
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
        ticket={ticket}
        comments={comments}
        onAddComment={handleAddComment}
        onStatusChange={handleStatusChange}
      />
    </MainLayout>
  );
}
