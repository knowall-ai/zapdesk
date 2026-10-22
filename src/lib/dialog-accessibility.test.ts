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

  it('declares type="button" rather than relying on where it sits', () => {
    // Not a live bug: the close button is in the header, and the optional
    // <form> is a sibling rendered after it, so it was never inside a form and
    // never submitted one. Stating the type anyway means moving the button --
    // or wrapping more of the shell in the form -- cannot turn closing into
    // submitting, which is a quiet way to break it.
    const tags = shell.match(/<button[^>]*>/g) ?? [];
    const close = tags.filter((tag) => tag.includes('aria-label="Close"'));
    expect(close, 'the close button should be findable by its label').toHaveLength(1);
    expect(close[0]).toContain('type="button"');
  });
});

describe('the dialog takes focus and gives it back (#507)', () => {
  it('is focusable, but stays out of the Tab order', () => {
    expect(shell).toContain('tabIndex={-1}');
    expect(shell).toContain('ref={dialogRef}');
  });

  it('moves focus into the dialog when it opens', () => {
    // aria-modal says what the dialog is; it moves nothing. Without this a
    // keyboard user stays focused on the row behind it.
    expect(shell).toContain('dialogRef.current?.focus()');
  });

  it('puts focus back where it came from on close', () => {
    expect(shell).toMatch(/const previous = document\.activeElement/);
    expect(shell).toMatch(/previous\?\.isConnected[\s\S]*previous\.focus\(\)/);
  });
});

describe('callers name the dialog after the item it shows', () => {
  it('passes the work item title and id as the label', () => {
    expect(dialog).toContain('label={`${workItem.title} (#${workItem.id})`}');
  });
});
