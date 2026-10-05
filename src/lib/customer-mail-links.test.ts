import { describe, it, expect } from 'vitest';
import {
  ticketConfirmationTemplate,
  agentReplyTemplate,
  statusChangeTemplate,
  customerReplyNotificationTemplate,
  assignmentNotificationTemplate,
  layoutWrapper,
} from './email-templates';

// A customer reached support by email and has no ZapDesk account, so a link
// into the app is an invitation to try and fail (#7371). Staff can follow
// theirs, so those stay.
const APP = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';

const CUSTOMER_MAIL: Array<[string, string]> = [
  [
    'the first automatic confirmation',
    ticketConfirmationTemplate({ ticketId: 7, subject: 'S', requesterName: 'Ada' }),
  ],
  [
    'an agent reply',
    agentReplyTemplate({ ticketId: 7, agentName: 'Eng', replyContent: '<p>hi</p>' }),
  ],
  [
    'a status change',
    statusChangeTemplate({
      ticketId: 7,
      subject: 'S',
      requesterName: 'Ada',
      oldStatus: 'New',
      newStatus: 'Active',
    }),
  ],
];

describe('mail to a customer carries no link into ZapDesk', () => {
  it.each(CUSTOMER_MAIL)('%s has no ticket link', (_name, html) => {
    expect(html).not.toContain(`${APP}/tickets/7`);
    expect(html).not.toContain('View Ticket');
  });

  it.each(CUSTOMER_MAIL)('%s does not link the logo either', (_name, html) => {
    expect(html).not.toContain(`<a href="${APP}"`);
  });

  // The way back is replying, which the footer already says.
  it.each(CUSTOMER_MAIL)('%s still tells them how to respond', (_name, html) => {
    expect(html).toContain('Please reply to this email');
  });
});

describe('mail to staff keeps its links', () => {
  const STAFF: Array<[string, string]> = [
    [
      'a customer reply notification',
      customerReplyNotificationTemplate({
        ticketId: 7,
        ticketSubject: 'S',
        customerEmail: 'c@example.test',
        replyContentHtml: '<p>hi</p>',
      }),
    ],
    [
      'an assignment notification',
      assignmentNotificationTemplate({ ticketId: 7, ticketSubject: 'S', assignedByName: 'Lead' }),
    ],
  ];

  it.each(STAFF)('%s links the ticket', (_name, html) => {
    expect(html).toContain(`${APP}/tickets/7`);
    expect(html).toContain('View Ticket');
  });
});

// A template that forgets to declare its audience must not mail a dead link
// to someone outside the company.
describe('the wrapper defaults to the safe audience', () => {
  it('omits the logo link when no audience is given', () => {
    expect(layoutWrapper('<p>x</p>')).not.toContain(`<a href="${APP}"`);
  });

  it('includes it only when staff is asked for', () => {
    expect(layoutWrapper('<p>x</p>', 'staff')).toContain(`<a href="${APP}"`);
  });
});
