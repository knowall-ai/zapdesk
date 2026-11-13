// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RequiredFieldsDialog from './RequiredFieldsDialog';

/**
 * Escape closes the innermost dialog, and only that one (#663 review).
 *
 * `TicketDialogShell` listens for Escape on `document`, and so does this
 * prompt. The pop-up mounts both at once, so one press closed the ticket
 * dialog underneath as well -- and did it even while a write was away, when
 * this prompt itself refuses to close.
 *
 * The stand-in below is the shell's own listener: `document`, keydown,
 * bubble phase. If this prompt stops listening in the capture phase, or stops
 * calling `stopPropagation`, these fail.
 */

const field = {
  referenceName: 'Custom.ApprovedDate',
  name: 'Approved Date',
  type: 'dateTime',
};

function renderPrompt(overrides: Partial<React.ComponentProps<typeof RequiredFieldsDialog>> = {}) {
  const onCancel = vi.fn();
  // What `TicketDialogShell` does: a bubble-phase listener on `document`.
  const shellClose = vi.fn();
  const shellListener = (event: KeyboardEvent) => {
    if (event.key === 'Escape') shellClose();
  };
  document.addEventListener('keydown', shellListener);

  render(
    <RequiredFieldsDialog
      targetType="Todo"
      changing="state"
      requiredFields={[field]}
      fieldValues={{}}
      onFieldChange={() => {}}
      onConfirm={async () => {}}
      onCancel={onCancel}
      isUpdating={false}
      members={[]}
      memberSearch=""
      onMemberSearchChange={() => {}}
      filteredMembers={[]}
      {...overrides}
    />
  );

  return {
    onCancel,
    shellClose,
    detach: () => document.removeEventListener('keydown', shellListener),
  };
}

afterEach(cleanup);

describe('Escape while the prompt is open', () => {
  it('closes the prompt', () => {
    const { onCancel, detach } = renderPrompt();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    detach();
  });

  it('does not close the dialog behind it', () => {
    const { shellClose, detach } = renderPrompt();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(shellClose).not.toHaveBeenCalled();
    detach();
  });

  // The prompt stays put while the PATCH is away, so the dialog behind it must
  // not go either -- that would leave the user looking at the board with a
  // write still running.
  it('closes neither while a write is away', () => {
    const { onCancel, shellClose, detach } = renderPrompt({ isUpdating: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(shellClose).not.toHaveBeenCalled();
    detach();
  });

  it('leaves other keys alone', () => {
    const { onCancel, shellClose, detach } = renderPrompt();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(shellClose).toHaveBeenCalledTimes(0);
    detach();
  });
});

describe('the prompt as a dialog', () => {
  it('says what it is, and is named after the move', () => {
    const { detach } = renderPrompt();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Named from its own heading, so a screen reader announces the move
    // rather than an unlabelled box. Queried by that name, which is the
    // accessible name computed from `aria-labelledby`.
    expect(screen.getByRole('dialog', { name: 'Move to Todo' })).toBe(dialog);
    detach();
  });

  it('takes focus, so a keyboard user is inside it', () => {
    const { detach } = renderPrompt();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    detach();
  });

  // Both ways out are shut while the write is away: the hook ignores a cancel
  // then, and nothing should invite one.
  it('offers no way out while a write is away', () => {
    const { detach } = renderPrompt({ isUpdating: true });
    // `jest-dom` matchers are not set up in this repo, so the property is
    // read directly.
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    detach();
  });
});
