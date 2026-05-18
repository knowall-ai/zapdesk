// Render every outbound email template into a single HTML file for visual
// review. Output path: email-preview.html (gitignored). Open in any browser.
// Run with: bun run scripts/preview-email-templates.mjs
import {
  ticketConfirmationTemplate,
  agentReplyTemplate,
  statusChangeTemplate,
  layoutWrapper,
} from '../src/lib/email-templates.ts';
import { writeFileSync } from 'node:fs';

const sections = [
  {
    title: 'ticketConfirmationTemplate',
    html: ticketConfirmationTemplate({
      ticketId: 1234,
      subject: 'Login flow broken on staging',
      requesterName: 'Akash Jadhav',
    }),
  },
  {
    title: 'agentReplyTemplate (with history)',
    html: agentReplyTemplate({
      ticketId: 1234,
      agentName: 'Sarah Patel',
      replyContent:
        '<p>Thanks for the detail — we reproduced this on staging too. Pushing a fix in the next deploy.</p>',
      history: [
        {
          authorName: 'Akash Jadhav',
          createdAt: new Date('2026-05-08T14:30:00Z'),
          contentHtml: '<p>Login still failing in incognito.</p>',
        },
        {
          authorName: 'Sarah Patel',
          createdAt: new Date('2026-05-08T15:10:00Z'),
          contentHtml: '<p>Got it — checking now.</p>',
        },
      ],
    }),
  },
  {
    title: 'statusChangeTemplate',
    html: statusChangeTemplate({
      ticketId: 1234,
      subject: 'Login flow broken on staging',
      requesterName: 'Akash Jadhav',
      oldStatus: 'Active',
      newStatus: 'Resolved',
    }),
  },
  {
    title: 'sendTestEmail body (via layoutWrapper)',
    html: layoutWrapper(
      `<div class="content"><p>This is a test email from your ZapDesk instance.</p></div>`
    ),
  },
];

const wrapper = `
<!doctype html>
<html><head><title>ZapDesk email preview</title>
<style>
body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; background: #fafafa; }
.section { max-width: 720px; margin: 0 auto 48px; }
.section h2 { font-size: 14px; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
iframe { width: 100%; height: 720px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; }
</style></head><body>
${sections
  .map(
    (s) =>
      `<div class="section"><h2>${s.title}</h2><iframe srcdoc="${s.html.replace(/"/g, '&quot;')}"></iframe></div>`
  )
  .join('')}
</body></html>`.trim();

writeFileSync('email-preview.html', wrapper);
console.log('wrote email-preview.html — open in a browser to review');
