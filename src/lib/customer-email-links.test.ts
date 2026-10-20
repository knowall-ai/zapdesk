import { describe, it, expect } from 'vitest';
import {
  agentReplyTemplate,
  assignmentNotificationTemplate,
  statusChangeTemplate,
  ticketConfirmationTemplate,
  ticketUpdatedTemplate,
} from './email-templates';

describe('customer emails carry no links into ZapDesk (#7371)', () => {
  const customerMails = {
    confirmation: ticketConfirmationTemplate({
      ticketId: 7,
      subject: 'Printer',
      requesterName: 'Ann',
    }),
    reply: agentReplyTemplate({ ticketId: 7, agentName: 'Bo', replyContent: '<p>Hi</p>' }),
    status: statusChangeTemplate({
      ticketId: 7,
      subject: 'Printer',
      requesterName: 'Ann',
      oldStatus: 'New',
      newStatus: 'Active',
    }),
    update: ticketUpdatedTemplate({
      ticketId: 7,
      subject: 'Printer',
      requesterName: 'Ann',
      changes: [{ label: 'Priority', from: 'Normal', to: 'High' }],
    }),
  };

  for (const [name, html] of Object.entries(customerMails)) {
    it(`${name}: no "View Ticket" button and no app link`, () => {
      expect(html).not.toContain('View Ticket');
      expect(html).not.toContain('/tickets/7');
      expect(html).not.toMatch(/<a href="http:\/\/localhost:3000"/);
    });
  }

  it('team mail still links to the ticket', () => {
    const html = assignmentNotificationTemplate({
      ticketId: 7,
      ticketSubject: 'Printer',
      assignedByName: 'Bo',
    });
    expect(html).toContain('/tickets/7');
  });
});

describe('ticket update email (#7724)', () => {
  it('lists each change and escapes the values', () => {
    const html = ticketUpdatedTemplate({
      ticketId: 7,
      subject: 'Printer',
      requesterName: 'Ann',
      changes: [{ label: 'Title', from: 'Old', to: '<b>New</b>' }],
    });
    expect(html).toContain('Old');
    expect(html).toContain('&lt;b&gt;New&lt;/b&gt;');
  });
});
