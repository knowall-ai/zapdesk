// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RequiredFieldsDialog from './RequiredFieldsDialog';

/**
 * Keyboard focus stays inside the required-fields prompt (#663 review).
 *
 * The prompt is `aria-modal`, but Tab walked out past its last button onto
 * the page behind -- the organisation switcher among it, where a keypress
 * could throw away the pending move and everything typed into it.
 *
 * jsdom does not move focus on Tab by itself, so these assert what the trap
 * does at the edges: where it sends focus, and that it cancels the browser's
 * own move there (`fireEvent` returns false once `preventDefault` is called).
 * Between the edges the browser is left alone.
 */

const field = {
  referenceName: 'Custom.ApprovedDate',
  name: 'Approved Date',
  type: 'dateTime',
};

function renderPrompt(isUpdating = false) {
  render(
    <>
      <button type="button">Behind the dialog</button>
      <RequiredFieldsDialog
        targetType="Todo"
        changing="state"
        requiredFields={[field]}
        fieldValues={{}}
        onFieldChange={() => {}}
        onConfirm={async () => {}}
        onCancel={() => {}}
        isUpdating={isUpdating}
        members={[]}
        memberSearch=""
        onMemberSearchChange={() => {}}
        filteredMembers={[]}
      />
    </>
  );
  const dialog = screen.getByRole('dialog');
  return {
    dialog,
    // With nothing filled in, the confirm button is disabled, so the last
    // control that can take focus is Cancel.
    close: screen.getByRole('button', { name: 'Close' }),
    date: dialog.querySelector('input[type="date"]') as HTMLInputElement,
    cancel: screen.getByRole('button', { name: 'Cancel' }),
    behind: screen.getByRole('button', { name: 'Behind the dialog' }),
  };
}

afterEach(() => {
  cleanup();
});

describe('Tab inside the required-fields prompt', () => {
  it('wraps from the last control to the first', () => {
    const { close, cancel } = renderPrompt();
    cancel.focus();

    const browserMoved = fireEvent.keyDown(cancel, { key: 'Tab' });

    expect(browserMoved).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it('wraps backwards from the first control to the last', () => {
    const { close, cancel } = renderPrompt();
    close.focus();

    const browserMoved = fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });

    expect(browserMoved).toBe(false);
    expect(document.activeElement).toBe(cancel);
  });

  // The dialog itself takes focus when it opens; Shift+Tab from there must
  // not step out to the page behind.
  it('wraps backwards from the dialog itself, where focus starts', () => {
    const { dialog, cancel } = renderPrompt();
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(cancel);
  });

  it('leaves Tab alone between the edges', () => {
    const { date } = renderPrompt();
    date.focus();

    const browserMoved = fireEvent.keyDown(date, { key: 'Tab' });

    expect(browserMoved).toBe(true);
    expect(document.activeElement).toBe(date);
  });

  // Mid-write both ways out are disabled, so the date field is the only
  // control left. Tab must keep focus on it rather than escape.
  it('skips disabled controls while the write is away', () => {
    const { date } = renderPrompt(true);
    date.focus();

    fireEvent.keyDown(date, { key: 'Tab' });
    expect(document.activeElement).toBe(date);

    fireEvent.keyDown(date, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(date);
  });
});

describe('Focus that reaches the page behind the prompt', () => {
  it('is brought back into the dialog', () => {
    const { close, behind } = renderPrompt();

    behind.focus();

    expect(document.activeElement).toBe(close);
  });

  it('is left alone once the prompt has closed', () => {
    const { behind } = renderPrompt();
    cleanup();
    render(<button type="button">Page after</button>);
    const after = screen.getByRole('button', { name: 'Page after' });

    after.focus();

    expect(document.activeElement).toBe(after);
    expect(behind.isConnected).toBe(false);
  });
});
