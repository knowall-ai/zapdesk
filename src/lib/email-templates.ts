/**
 * HTML email templates for ZapDesk outbound emails.
 * All templates share a common layout with ZapDesk branding.
 */

const APP_NAME = process.env.APP_NAME || 'ZapDesk';
const APP_URL = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';

function layoutWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; color: #18181b; }
    .container { max-width: 600px; margin: 0 auto; padding: 24px; }
    .card { background: #ffffff; border-radius: 8px; padding: 24px; border: 1px solid #e4e4e7; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 20px; color: #22c55e; margin: 0; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-new { background: #3b82f6; color: #fff; }
    .badge-active { background: #22c55e; color: #fff; }
    .badge-resolved { background: #8b5cf6; color: #fff; }
    .badge-closed { background: #6b7280; color: #fff; }
    .content { margin: 16px 0; line-height: 1.6; }
    .quoted { border-left: 3px solid #d4d4d8; padding-left: 12px; margin: 16px 0; color: #71717a; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #a1a1aa; }
    .footer a { color: #22c55e; text-decoration: none; }
    .btn { display: inline-block; padding: 10px 20px; background: #22c55e; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; }
    .meta { font-size: 13px; color: #71717a; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>⚡ ${APP_NAME}</h1>
      </div>
      ${content}
    </div>
    <div class="footer">
      <p>Powered by <a href="${APP_URL}">${APP_NAME}</a></p>
      <p>Please reply to this email to update your ticket.</p>
    </div>
  </div>
</body>
</html>`.trim();
}

function statusBadge(status: string): string {
  const lower = status.toLowerCase();
  let cls = 'badge-new';
  if (lower.includes('active') || lower.includes('progress')) cls = 'badge-active';
  else if (lower.includes('resolved') || lower.includes('done')) cls = 'badge-resolved';
  else if (lower.includes('closed') || lower.includes('removed')) cls = 'badge-closed';
  return `<span class="badge ${cls}">${status}</span>`;
}

export function ticketConfirmationTemplate(opts: {
  ticketId: number;
  subject: string;
  requesterName: string;
}): string {
  const ticketUrl = `${APP_URL}/tickets/${opts.ticketId}`;
  return layoutWrapper(`
    <p>Hi ${opts.requesterName || 'there'},</p>
    <div class="content">
      <p>We've received your request and created ticket <strong>#${opts.ticketId}</strong>.</p>
      <p class="meta"><strong>Subject:</strong> ${opts.subject}</p>
      <p>Our team will review your request and get back to you as soon as possible.</p>
      <p style="text-align: center; margin-top: 24px;">
        <a href="${ticketUrl}" class="btn">View Ticket #${opts.ticketId}</a>
      </p>
    </div>
  `);
}

export function agentReplyTemplate(opts: {
  ticketId: number;
  agentName: string;
  replyContent: string;
  ticketUrl?: string;
}): string {
  const ticketUrl = opts.ticketUrl || `${APP_URL}/tickets/${opts.ticketId}`;
  return layoutWrapper(`
    <p class="meta">${opts.agentName} replied to ticket <strong>#${opts.ticketId}</strong>:</p>
    <div class="content">
      ${opts.replyContent}
    </div>
    <p style="text-align: center; margin-top: 24px;">
      <a href="${ticketUrl}" class="btn">View Ticket #${opts.ticketId}</a>
    </p>
  `);
}

export function statusChangeTemplate(opts: {
  ticketId: number;
  subject: string;
  requesterName: string;
  oldStatus: string;
  newStatus: string;
}): string {
  const ticketUrl = `${APP_URL}/tickets/${opts.ticketId}`;
  return layoutWrapper(`
    <p>Hi ${opts.requesterName || 'there'},</p>
    <div class="content">
      <p>The status of your ticket <strong>#${opts.ticketId}</strong> has been updated:</p>
      <p style="text-align: center; font-size: 16px;">
        ${statusBadge(opts.oldStatus)} &rarr; ${statusBadge(opts.newStatus)}
      </p>
      <p class="meta"><strong>Subject:</strong> ${opts.subject}</p>
      <p style="text-align: center; margin-top: 24px;">
        <a href="${ticketUrl}" class="btn">View Ticket #${opts.ticketId}</a>
      </p>
    </div>
  `);
}
