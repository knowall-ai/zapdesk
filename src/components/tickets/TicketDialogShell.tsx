'use client';

import { useEffect, useRef } from 'react';
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
  /**
   * What a screen reader announces when the dialog opens. The header is built
   * from nodes the caller passes, so there is nothing here to point
   * `aria-labelledby` at; callers that know the ticket should say so (#507).
   */
  label?: string;
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
  label = 'Ticket details',
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

  /**
   * Move focus into the dialog, and put it back where it came from on close.
   *
   * `aria-modal` says what the dialog is; it moves nothing. Without this a
   * keyboard user who opens a ticket is still focused on the row behind the
   * dialog, and closing it drops them at the top of the document rather than
   * on the ticket they just came out of (#507).
   *
   * Focus trapping -- keeping Tab inside while it is open -- is a separate,
   * larger change and is deliberately not attempted here.
   */
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      // The trigger can be gone by now -- a deleted ticket's row, say -- so
      // this is only ever a best effort.
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const ContentWrapper = asForm ? 'form' : 'div';
  const contentProps = asForm ? { onSubmit } : {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop. Decorative: Escape and the close button are the real ways
          out, so it is hidden rather than announced as an empty control. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // Focusable so focus can be moved here on open; -1 keeps it out of the
        // Tab order itself.
        tabIndex={-1}
        className="relative z-10 flex w-full max-w-4xl flex-col overflow-hidden rounded-lg"
        style={{
          height: '85vh',
          backgroundColor: 'var(--background)',
          border: '1px solid var(--border)',
        }}
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
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close"
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
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>

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
