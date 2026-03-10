'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface TicketDialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  headerLeft: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  sidebar?: React.ReactNode;
  asForm?: boolean;
  onSubmit?: (e: React.FormEvent) => void;
}

export default function TicketDialogShell({
  isOpen,
  onClose,
  headerLeft,
  headerRight,
  children,
  sidebar,
  asForm,
  onSubmit,
}: TicketDialogShellProps) {
  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const ContentWrapper = asForm ? 'form' : 'div';
  const contentProps = asForm ? { onSubmit } : {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg"
        style={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b p-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">{headerLeft}</div>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <ContentWrapper {...contentProps} className="flex flex-1 overflow-hidden">
          {/* Main content area */}
          <div className="flex flex-1 flex-col overflow-hidden">{children}</div>

          {/* Optional sidebar */}
          {sidebar && (
            <div
              className="w-72 overflow-auto border-l"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
            >
              {sidebar}
            </div>
          )}
        </ContentWrapper>
      </div>
    </div>
  );
}
