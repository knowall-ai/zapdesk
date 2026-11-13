'use client';

import { useEffect, useId, useRef } from 'react';
import { X, Loader2, Search } from 'lucide-react';
import type { RequiredField } from '@/hooks/useWorkItemActions';
import type { User } from '@/types';
import { buildIdentityString, getDisplayNameFromIdentity } from '@/lib/identity';

interface RequiredFieldsDialogProps {
  /** What the change is to: a work item type, or a state. */
  targetType: string;
  /**
   * What is being changed, for the heading and the sentence above the fields.
   * A process can require fields on a state transition as well as on a type
   * (#651), and "Change to Todo … required for Todo work items" would be a
   * lie about what the user is doing.
   */
  changing?: 'type' | 'state';
  requiredFields: RequiredField[];
  fieldValues: Record<string, string>;
  onFieldChange: (fieldRef: string, value: string) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isUpdating: boolean;
  // People picker support
  members: User[];
  /**
   * Whether the member list is still being fetched. Without it an empty list
   * was indistinguishable from a pending one, so a failed request showed
   * "Loading..." for ever (raised in review on #652).
   */
  membersLoading?: boolean;
  memberSearch: string;
  onMemberSearchChange: (search: string) => void;
  filteredMembers: User[];
}

const PEOPLE_PICKER_FIELDS = new Set(['Custom.FoundBy']);

export default function RequiredFieldsDialog({
  targetType,
  changing = 'type',
  requiredFields,
  fieldValues,
  onFieldChange,
  onConfirm,
  onCancel,
  isUpdating,
  members,
  membersLoading = false,
  memberSearch,
  onMemberSearchChange,
  filteredMembers,
}: RequiredFieldsDialogProps) {
  const allFieldsFilled = requiredFields.every((f) => {
    const value = fieldValues[f.referenceName];
    return !!value;
  });

  /**
   * Both ways out are shut while the write is away.
   *
   * Cancelling then would put the card back in its old column while the PATCH
   * carried on and very likely succeeded, leaving the board and the server
   * telling different stories (#663 review). `useBoardStateChange` refuses a
   * cancel mid-write as well; this is so nothing invites one.
   */
  const canLeave = !isUpdating;

  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Move focus into the dialog, and put it back where it came from on close.
   *
   * This had none of a dialog's semantics: no role, no name, no focus. A
   * screen reader announced nothing when it opened, and a keyboard user was
   * left on the card behind it (raised in review on #663). It follows
   * `TicketDialogShell`, including its decision not to attempt a focus trap --
   * that is a larger change, and the hook above covers the one consequence
   * that mattered, a pending change outliving the organisation it was asked in.
   */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      // The trigger can be gone by now -- a card that moved column, say -- so
      // this is only ever a best effort.
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  /**
   * Escape closes this prompt, and only this prompt.
   *
   * `TicketDialogShell` listens for Escape on `document` too, and when the
   * pop-up opens this prompt both are mounted at once -- so one press closed
   * the ticket dialog underneath as well, and did it even mid-write, when this
   * prompt itself refuses to close (raised in review on #663).
   *
   * Listening in the capture phase and stopping the event there means the
   * innermost dialog is the one that answers, which is what a modal should do.
   * Nothing nested here handles Escape of its own -- the people picker is a
   * search box and a list -- so nothing else is swallowed.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stopped whether or not it acts: while a write is away this prompt
      // stays put, and the dialog behind it must not close either.
      event.stopPropagation();
      if (!isUpdating) onCancel();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isUpdating, onCancel]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="mx-4 w-full max-w-md rounded-lg shadow-xl outline-none"
        style={{ backgroundColor: 'var(--background)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <h3
            id={headingId}
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {changing === 'state' ? `Move to ${targetType}` : `Change to ${targetType}`}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={!canLeave}
            aria-label="Close"
            className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {changing === 'state'
              ? `${targetType} requires these before the ticket can move:`
              : `The following fields are required for ${targetType} work items:`}
          </p>

          {requiredFields.map((field) => {
            // The field says whether it holds a person. The name list is kept
            // only for the type endpoint, which does not report it yet.
            const isPeoplePicker =
              field.isIdentity === true || PEOPLE_PICKER_FIELDS.has(field.referenceName);

            if (isPeoplePicker) {
              const selectedValue = fieldValues[field.referenceName];
              return (
                <div key={field.referenceName}>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {field.name} *
                  </label>
                  {members.length === 0 && membersLoading ? (
                    <div
                      className="flex items-center gap-2 text-sm"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Loader2 className="animate-spin" size={14} />
                      Loading...
                    </div>
                  ) : members.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Nobody could be loaded for this field. Close this and try again, or set{' '}
                      {field.name} in Azure DevOps.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {/* Search input */}
                      <div className="relative">
                        <Search
                          size={14}
                          className="absolute top-1/2 left-2 -translate-y-1/2"
                          style={{ color: 'var(--text-muted)' }}
                        />
                        <input
                          type="text"
                          placeholder="Search users..."
                          value={memberSearch}
                          onChange={(e) => onMemberSearchChange(e.target.value)}
                          className="input w-full pl-7 text-sm"
                        />
                      </div>
                      {/* Selected user or member list */}
                      {selectedValue && selectedValue.trim() ? (
                        <div
                          className="flex items-center justify-between rounded p-2"
                          style={{ backgroundColor: 'var(--surface-hover)' }}
                        >
                          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                            {getDisplayNameFromIdentity(selectedValue)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onFieldChange(field.referenceName, '');
                              onMemberSearchChange('');
                            }}
                            className="text-xs hover:underline"
                            style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                          >
                            clear
                          </button>
                        </div>
                      ) : (
                        <div
                          className="max-h-32 overflow-auto rounded"
                          style={{ border: '1px solid var(--border)' }}
                        >
                          {filteredMembers.length === 0 ? (
                            <p
                              className="p-2 text-center text-xs"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              No users found
                            </p>
                          ) : (
                            filteredMembers.map((member) => (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => {
                                  onFieldChange(field.referenceName, buildIdentityString(member));
                                  onMemberSearchChange('');
                                }}
                                className="block w-full px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                                style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                              >
                                {member.displayName}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            // Dropdown for fields with allowed values
            if (field.allowedValues && field.allowedValues.length > 0) {
              return (
                <div key={field.referenceName}>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {field.name} *
                  </label>
                  <select
                    value={fieldValues[field.referenceName] || ''}
                    onChange={(e) => onFieldChange(field.referenceName, e.target.value)}
                    className="input w-full text-sm"
                  >
                    <option value="">Select {field.name}...</option>
                    {field.allowedValues.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            // A date field gets a date control. Typing one into a text box
            // meant guessing the format DevOps would accept, and getting it
            // wrong is only found out when the update is refused.
            if (field.type === 'dateTime' || field.type === 'date') {
              return (
                <div key={field.referenceName}>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {field.name} *
                  </label>
                  <input
                    type="date"
                    value={(fieldValues[field.referenceName] || '').slice(0, 10)}
                    onChange={(e) => onFieldChange(field.referenceName, e.target.value)}
                    className="input w-full text-sm"
                  />
                </div>
              );
            }

            // Text input fallback
            return (
              <div key={field.referenceName}>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {field.name} *
                </label>
                <input
                  type="text"
                  value={fieldValues[field.referenceName] || ''}
                  onChange={(e) => onFieldChange(field.referenceName, e.target.value)}
                  placeholder={`Enter ${field.name}...`}
                  className="input w-full text-sm"
                />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={!canLeave}
            className="rounded-md px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!allFieldsFilled || isUpdating}
            className="btn-primary rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            {isUpdating ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Changing...
              </span>
            ) : (
              `Change to ${targetType}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
