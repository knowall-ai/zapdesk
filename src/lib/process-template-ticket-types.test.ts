import { describe, it, expect } from 'vitest';
import { TICKET_WORK_ITEM_TYPES } from '@/types';
import { getSupportedTemplates, getTemplateConfig } from '@/config/process-templates';

/**
 * The read filter and what ticket creation can produce must agree (#7379).
 *
 * `TICKET_WORK_ITEM_TYPES` is what the Tickets screen, the SLA read and the
 * work item board use to decide what counts as a ticket. Ticket creation, given
 * no type, uses the project's configured `defaultTicketType` -- which is
 * `Product Backlog Item` on Scrum and `Ticket` on the Support Ticket process.
 *
 * If the two lists drift, the failure is the worst kind: the create succeeds,
 * reports success, and the ticket is simply absent from the screen. Nothing
 * else in the codebase links them, so this test is the link.
 */
describe('every configured ticket type is readable as a ticket', () => {
  const templates = getSupportedTemplates();

  it('covers more than one template, or this test proves nothing', () => {
    expect(templates.length).toBeGreaterThan(1);
  });

  it.each(getSupportedTemplates())('reads back every ticket type of %s', (name) => {
    for (const type of getTemplateConfig(name).workItemTypes.ticketTypes) {
      expect(TICKET_WORK_ITEM_TYPES, `${name} lists ${type} as a ticket type`).toContain(type);
    }
  });

  // The default is the one creation reaches without anybody choosing, so it is
  // the one most likely to go unnoticed.
  it.each(getSupportedTemplates())('reads back the default ticket type of %s', (name) => {
    const fallback = getTemplateConfig(name).workItemTypes.defaultTicketType;
    expect(TICKET_WORK_ITEM_TYPES, `${name} defaults to ${fallback}`).toContain(fallback);
  });

  it('has no duplicates', () => {
    expect(new Set(TICKET_WORK_ITEM_TYPES).size).toBe(TICKET_WORK_ITEM_TYPES.length);
  });

  // The planning levels belong to the Projects screen, so widening this list
  // must not have quietly swept them in.
  it.each(['Epic', 'Feature', 'User Story'])('still leaves %s off the Tickets screen', (type) => {
    expect(TICKET_WORK_ITEM_TYPES).not.toContain(type);
  });
});
