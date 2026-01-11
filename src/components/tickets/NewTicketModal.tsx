'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { TicketType } from '@/types';

interface NewTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  onTicketCreated: () => void;
}

export function NewTicketModal({
  isOpen,
  onClose,
  projectName,
  onTicketCreated,
}: NewTicketModalProps) {
  const [ticketType, setTicketType] = useState<TicketType>('Feature');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) {
      setError('Please enter a subject');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const tags = ['ticket', ticketType.toLowerCase()];

      // Strip any existing type prefix to prevent duplicates like "[Feature] [Feature]"
      const cleanSubject = subject.trim().replace(/^\[(Bug|Feature)\]\s*/i, '');

      const response = await fetch('/api/devops/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: projectName,
          title: `[${ticketType}] ${cleanSubject}`,
          description: description.trim(),
          priority,
          tags,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create ticket');
      }

      // Reset form
      setSubject('');
      setDescription('');
      setPriority(3);
      setTicketType('Feature');

      onTicketCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      onClick={handleClose}
    >
      <div
        className="card mx-4 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b p-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Create New Ticket
          </h2>
          <button
            onClick={handleClose}
            className="rounded p-1 hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4">
          {error && (
            <div
              className="mb-4 rounded-md p-3 text-sm"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
            >
              {error}
            </div>
          )}

          {/* Ticket Type */}
          <div className="mb-4">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Type
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setTicketType('Feature');
                }}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  ticketType === 'Feature' ? 'ring-2' : ''
                }`}
                style={{
                  backgroundColor:
                    ticketType === 'Feature' ? 'rgba(34, 197, 94, 0.2)' : 'var(--background)',
                  color: ticketType === 'Feature' ? 'var(--primary)' : 'var(--text-secondary)',
                  borderColor: ticketType === 'Feature' ? 'var(--primary)' : 'transparent',
                }}
              >
                Feature
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setTicketType('Bug');
                }}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  ticketType === 'Bug' ? 'ring-2' : ''
                }`}
                style={{
                  backgroundColor:
                    ticketType === 'Bug' ? 'rgba(239, 68, 68, 0.2)' : 'var(--background)',
                  color: ticketType === 'Bug' ? '#ef4444' : 'var(--text-secondary)',
                  borderColor: ticketType === 'Bug' ? '#ef4444' : 'transparent',
                }}
              >
                Bug
              </button>
            </div>
          </div>

          {/* Subject */}
          <div className="mb-4">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Subject *
            </label>
            <input
              type="text"
              placeholder="Enter ticket subject..."
              value={subject}
              onChange={(e) => {
                setError(null);
                setSubject(e.target.value);
              }}
              className="input w-full"
              required
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Description
            </label>
            <textarea
              placeholder="Describe the ticket..."
              value={description}
              onChange={(e) => {
                setError(null);
                setDescription(e.target.value);
              }}
              className="input min-h-[100px] w-full resize-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Priority */}
          <div className="mb-6">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => {
                setError(null);
                const parsed = parseInt(e.target.value, 10);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) {
                  setPriority(parsed);
                }
              }}
              className="input w-full"
              disabled={isSubmitting}
            >
              <option value={1}>Urgent</option>
              <option value={2}>High</option>
              <option value={3}>Normal</option>
              <option value={4}>Low</option>
            </select>
          </div>

          {/* Project info */}
          <div
            className="mb-4 rounded-md p-3 text-sm"
            style={{ backgroundColor: 'var(--background)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Project: </span>
            <span style={{ color: 'var(--text-primary)' }}>{projectName}</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="btn-secondary"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="animate-spin" size={16} />}
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
