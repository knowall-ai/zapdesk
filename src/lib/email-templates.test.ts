import { describe, it, expect } from 'vitest';
import {
  customerReplyNotificationTemplate,
  ticketConfirmationTemplate,
  statusChangeTemplate,
} from './email-templates';

// Everything these templates render is attacker-reachable: the subject, the
// requester name and the from-address all arrive on an inbound email that
// anyone can send. Raw interpolation put that markup into mail delivered to an
// agent, and back to the customer.
const PAYLOAD = '<img src=x onerror="alert(1)">';

describe('customerReplyNotificationTemplate', () => {
  it('escapes the subject and the customer address', () => {
    const html = customerReplyNotificationTemplate({
      ticketId: 42,
      ticketSubject: PAYLOAD,
      customerEmail: `sender-address${PAYLOAD}`,
      replyContentHtml: '<p>hello</p>',
    });

    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('leaves the reply body HTML intact — renderEmailBody already made it safe', () => {
    const html = customerReplyNotificationTemplate({
      ticketId: 42,
      ticketSubject: 'Printer is on fire',
      customerEmail: 'sender-address',
      replyContentHtml: '<p>Still <strong>smoking</strong></p>',
    });

    expect(html).toContain('<p>Still <strong>smoking</strong></p>');
  });
});

describe('the customer-facing templates', () => {
  it('escapes the subject and requester name on the confirmation', () => {
    const html = ticketConfirmationTemplate({
      ticketId: 7,
      subject: PAYLOAD,
      requesterName: PAYLOAD,
    });

    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('&lt;img');
  });

  it('escapes the subject, requester name and both status names', () => {
    const html = statusChangeTemplate({
      ticketId: 7,
      subject: PAYLOAD,
      requesterName: PAYLOAD,
      oldStatus: PAYLOAD,
      newStatus: 'Active',
    });

    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('Active');
  });

  it('renders ordinary values unchanged apart from the escaping', () => {
    const html = ticketConfirmationTemplate({
      ticketId: 7,
      subject: 'Cannot log in',
      requesterName: 'Jane Doe',
    });

    expect(html).toContain('Cannot log in');
    expect(html).toContain('Hi Jane Doe,');
  });

  it('escapes an apostrophe in a name rather than dropping it', () => {
    const html = ticketConfirmationTemplate({
      ticketId: 7,
      subject: 'Access',
      requesterName: "Ciara O'Neill",
    });

    expect(html).toContain('Ciara O&#39;Neill');
  });
});
