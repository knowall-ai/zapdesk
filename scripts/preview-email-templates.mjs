// Render every outbound email template into a single HTML file for visual
// review. Output path: email-preview.html (gitignored). Open in any browser.
// Run with: bun run scripts/preview-email-templates.mjs
//
// The people here are invented (CONTRIBUTING.md): nothing in this repository
// should carry a real colleague's or customer's name.
//
// Templates are grouped by audience, because the rule they exist to enforce is
// an audience rule: customer mail carries no link into ZapDesk, since customers
// have no account to sign in with, while team mail keeps its links (#7371).
// Seeing both groups side by side is the only way to check that by eye.
import {
  ticketConfirmationTemplate,
  agentReplyTemplate,
  statusChangeTemplate,
  ticketUpdatedTemplate,
  customerReplyNotificationTemplate,
  newTicketNotificationTemplate,
  assignmentNotificationTemplate,
  layoutWrapper,
} from '../src/lib/email-templates.ts';
import { writeFileSync } from 'node:fs';

const CUSTOMER = { name: 'Jordan Avery', email: 'jordan.avery@example.com' };
const AGENT = { name: 'Riley Quinn' };
const SUBJECT = 'Login flow broken on staging';
const TICKET = 1234;

const customerFacing = [
  {
    title: 'ticketConfirmationTemplate',
    html: ticketConfirmationTemplate({
      ticketId: TICKET,
      subject: SUBJECT,
      requesterName: CUSTOMER.name,
    }),
  },
  {
    title: 'agentReplyTemplate (with history)',
    html: agentReplyTemplate({
      ticketId: TICKET,
      agentName: AGENT.name,
      replyContent:
        '<p>Thanks for the detail — we reproduced this on staging too. Pushing a fix in the next deploy.</p>',
      history: [
        {
          authorName: CUSTOMER.name,
          createdAt: new Date('2026-05-08T14:30:00Z'),
          contentHtml: '<p>Login still failing in incognito.</p>',
        },
        {
          authorName: AGENT.name,
          createdAt: new Date('2026-05-08T15:10:00Z'),
          contentHtml: '<p>Got it — checking now.</p>',
        },
      ],
    }),
  },
  {
    title: 'statusChangeTemplate',
    html: statusChangeTemplate({
      ticketId: TICKET,
      subject: SUBJECT,
      requesterName: CUSTOMER.name,
      oldStatus: 'Active',
      newStatus: 'Resolved',
    }),
  },
  {
    title: 'ticketUpdatedTemplate (title and priority changed)',
    html: ticketUpdatedTemplate({
      ticketId: TICKET,
      subject: SUBJECT,
      requesterName: CUSTOMER.name,
      changes: [
        { label: 'Title', from: 'Cannot log in', to: SUBJECT },
        { label: 'Priority', from: 'Normal', to: 'High' },
      ],
    }),
  },
];

const teamFacing = [
  {
    title: 'customerReplyNotificationTemplate',
    html: customerReplyNotificationTemplate({
      ticketId: TICKET,
      ticketSubject: SUBJECT,
      customerEmail: CUSTOMER.email,
      replyContentHtml: '<p>Still happening this morning, same browser.</p>',
    }),
  },
  {
    title: 'newTicketNotificationTemplate',
    html: newTicketNotificationTemplate({
      ticketId: TICKET,
      ticketSubject: SUBJECT,
      requesterEmail: CUSTOMER.email,
      project: 'Example Ltd',
      messageHtml: '<p>Nobody on my team can sign in to staging since this morning.</p>',
    }),
  },
  {
    title: 'assignmentNotificationTemplate',
    html: assignmentNotificationTemplate({
      ticketId: TICKET,
      ticketSubject: SUBJECT,
      assignedByName: AGENT.name,
      requesterEmail: CUSTOMER.email,
    }),
  },
  {
    title: 'sendTestEmail body (via layoutWrapper)',
    html: layoutWrapper(
      `<div class="content"><p>This is a test email from your ZapDesk instance.</p></div>`
    ),
  },
];

const groups = [
  {
    heading: 'To customers — no links into ZapDesk (#7371)',
    note: 'Customers have no ZapDesk account, so a link only leads to a sign-in page they cannot get past. Check for a "View Ticket" button, and for a logo that is a link.',
    sections: customerFacing,
  },
  {
    heading: 'To the support team — links kept',
    note: 'The team can sign in, so these keep their links into the app.',
    sections: teamFacing,
  },
];

const renderSection = (s) =>
  `<div class="section"><h3>${s.title}</h3><iframe srcdoc="${s.html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></div>`;

const wrapper = `
<!doctype html>
<html><head><title>ZapDesk email preview</title>
<style>
body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; background: #fafafa; color: #222; }
.group { max-width: 720px; margin: 0 auto 56px; }
.group > h2 { font-size: 18px; margin: 0 0 4px; }
.group > p { margin: 0 0 24px; color: #555; font-size: 14px; line-height: 1.5; }
.section { margin: 0 0 40px; }
.section h3 { font-size: 13px; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
iframe { width: 100%; height: 720px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; }
</style></head><body>
${groups
  .map(
    (g) =>
      `<div class="group"><h2>${g.heading}</h2><p>${g.note}</p>${g.sections.map(renderSection).join('')}</div>`
  )
  .join('')}
</body></html>`.trim();

writeFileSync('email-preview.html', wrapper);
const count = groups.reduce((n, g) => n + g.sections.length, 0);
console.log(`wrote email-preview.html with ${count} sections — open in a browser to review`);
