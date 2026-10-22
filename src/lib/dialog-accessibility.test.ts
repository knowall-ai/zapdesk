import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the dialog's callers pass it (#507).
 *
 * The shell's own behaviour -- its role, name, modal state, close button,
 * Escape, the backdrop and focus -- is asserted against the rendered DOM in
 * `components/tickets/TicketDialogShell.test.tsx`, which proves more than
 * matching strings in the source ever did. Those source checks were removed
 * rather than kept alongside it; two copies of the same claim is two things to
 * maintain and one of them can quietly go stale.
 *
 * What is left is the part rendering the shell alone cannot show: that a caller
 * gives it a useful name. Rendering `WorkItemDetailDialog` for that would mean
 * standing up the organisation provider, the API hooks and a work item, which
 * is a lot of scaffolding to assert one prop.
 */
const dialog = readFileSync(
  join(__dirname, '..', 'components', 'tickets', 'WorkItemDetailDialog.tsx'),
  'utf8'
);

describe('callers name the dialog after the item it shows (#507)', () => {
  it('passes the work item title and id as the label', () => {
    // Without this the dialog falls back to "Ticket details", which is true of
    // every ticket and so tells a screen reader user nothing about this one.
    expect(dialog).toContain('label={`${workItem.title} (#${workItem.id})`}');
  });
});
