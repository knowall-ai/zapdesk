// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TicketDialogShell from './TicketDialogShell';

/**
 * The dialog's accessibility, asserted against what it renders rather than
 * against its source (#507).
 *
 * `dialog-accessibility.test.ts` matched strings in the TSX, which proved the
 * attributes were written but not that they reached the DOM, survived a
 * refactor of the markup, or behaved. Raised in review on #508: the role, the
 * name, the modal state and the close behaviour are all observable, so they are
 * observed here.
 */
afterEach(cleanup);

const open = (props: Partial<React.ComponentProps<typeof TicketDialogShell>> = {}) =>
  render(
    <TicketDialogShell
      isOpen
      onClose={props.onClose ?? vi.fn()}
      headerLeft={<span>Header</span>}
      {...props}
    >
      <p>Body</p>
    </TicketDialogShell>
  );

describe('TicketDialogShell renders as a dialog', () => {
  it('is findable by role', () => {
    open();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('is modal', () => {
    open();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });

  it('takes its accessible name from the caller', () => {
    open({ label: 'Printer jammed (#1405)' });
    expect(screen.getByRole('dialog', { name: 'Printer jammed (#1405)' })).toBeDefined();
  });

  it('takes focus without joining the Tab order', () => {
    open();
    expect(screen.getByRole('dialog').getAttribute('tabindex')).toBe('-1');
  });

  it('is never nameless, even when the caller gives no label', () => {
    open();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBeTruthy();
  });

  it('renders nothing at all when closed', () => {
    render(
      <TicketDialogShell isOpen={false} onClose={vi.fn()} headerLeft={<span>Header</span>}>
        <p>Body</p>
      </TicketDialogShell>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the close button', () => {
  it('is reachable by name, not just as an icon', () => {
    open();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
  });

  it('closes when clicked', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is a plain button, so it can never submit a form', () => {
    // The arrangement test below proves it sits outside the form today; this
    // keeps it safe if the form is ever widened to wrap the header.
    open();
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('type')).toBe('button');
  });

  it('does not submit the surrounding form', () => {
    // The button sits in the header, outside the <form> the shell renders when
    // asForm is set -- so this asserts the arrangement holds, rather than that
    // type="button" rescues a button inside the form.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onClose = vi.fn();
    open({ asForm: true, onSubmit, onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('dismissal', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    open({ onClose });
    // Found by position, not by aria-hidden: the close button's icon is
    // aria-hidden too, and clicking it would close the dialog on its own.
    const backdrop = screen.getByRole('dialog').previousElementSibling as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    expect(backdrop!.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop!.closest('button')).toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Escape once closed', () => {
    // The listener is on document, so one left behind would keep firing for
    // every dialog opened afterwards.
    const onClose = vi.fn();
    const { unmount } = open({ onClose });
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('focus', () => {
  it('moves into the dialog when it opens', () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  // cleanup() removes only what render() mounted, so a trigger appended by
  // hand is removed here too -- even when an assertion fails before the test
  // gets to it, so it cannot leak into the tests that follow.
  const triggers: HTMLElement[] = [];
  const addTrigger = () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    triggers.push(trigger);
    return trigger;
  };
  afterEach(() => triggers.splice(0).forEach((t) => t.remove()));

  it('returns to whatever was focused before, on close', () => {
    const trigger = addTrigger();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = open();
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves focus alone when the trigger is gone by the time it closes', () => {
    // A deleted ticket's row: the element that opened the dialog can be
    // removed while it is open, so focus is restored only if it is still there.
    const trigger = addTrigger();
    trigger.focus();

    const { unmount } = open();
    trigger.remove();
    const focus = vi.spyOn(trigger, 'focus');

    unmount();
    expect(focus).not.toHaveBeenCalled();
  });
});
