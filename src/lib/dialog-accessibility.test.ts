import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the ticket dialog's accessibility markup (#507).
 *
 * `TicketDialogShell` rendered as a plain div: no role, no `aria-modal`, no
 * name, and a close button whose only content is an icon. A screen reader
 * announced "button" and never said a dialog had opened.
 *
 * There is no component-rendering setup in this repo -- vitest runs in `node`
 * and collects only `src/**\/*.test.ts` -- so the markup is checked at source,
 * the same way work-item-fields.test.ts guards its field list. Attributes are
 * easy to delete in a refactor and nothing else would fail if they were.
 */
const componentPath = (name: string) =>
  join(__dirname, '..', 'components', 'tickets', `${name}.tsx`);
const shell = readFileSync(componentPath('TicketDialogShell'), 'utf8');
const dialog = readFileSync(componentPath('WorkItemDetailDialog'), 'utf8');

describe('TicketDialogShell is announced as a dialog (#507)', () => {
  it('carries a dialog role', () => {
    expect(shell).toContain('role="dialog"');
  });

  it('is marked modal, so the content behind it is not read as well', () => {
    expect(shell).toContain('aria-modal="true"');
  });

  it('has an accessible name', () => {
    expect(shell).toContain('aria-label={label}');
  });

  it('falls back to a name rather than none when the caller gives no label', () => {
    // An unnamed dialog is announced as just "dialog", which says nothing.
    expect(shell).toMatch(/label = '[^']+'/);
  });

  it('hides the decorative backdrop from assistive technology', () => {
    expect(shell).toMatch(/aria-hidden="true"[^>]*className="absolute inset-0 bg-black\/50"/);
  });
});

describe('the dialog close button (#507)', () => {
  it('has an accessible name, not just an icon', () => {
    expect(shell).toContain('aria-label="Close"');
  });

  it('is type="button", so it cannot submit the form it sits inside', () => {
    // The shell renders a <form> when asForm is set. Without an explicit type a
    // button inside a form defaults to submit, so closing would have submitted
    // the ticket instead of dismissing the dialog.
    const tags = shell.match(/<button[^>]*>/g) ?? [];
    const close = tags.filter((tag) => tag.includes('aria-label="Close"'));
    expect(close, 'the close button should be findable by its label').toHaveLength(1);
    expect(close[0]).toContain('type="button"');
  });
});

describe('callers name the dialog after the item it shows', () => {
  it('passes the work item title and id as the label', () => {
    expect(dialog).toContain('label={`${workItem.title} (#${workItem.id})`}');
  });
});
