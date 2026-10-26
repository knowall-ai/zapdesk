/**
 * HTML email templates for ZapDesk outbound mail.
 * All templates share a common card layout with branding.
 */

/**
 * Escape a plain-text value for interpolation into an HTML email.
 *
 * Everything these templates render is attacker-reachable: a ticket subject,
 * a requester name and a customer address all arrive on an inbound email that
 * anyone can send. Interpolated raw they inject markup into mail delivered to
 * an agent — and back to the customer. Fields already carrying HTML (the
 * `*Html` ones, produced by renderEmailBody) are deliberately not escaped.
 */
function escapeText(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(value ?? '').replace(/[&<>"']/g, (char) => entities[char]);
}

const APP_NAME = process.env.APP_NAME || 'ZapDesk';
const APP_URL = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
// Logo URLs: env-overridable for deployments where outbound mail can't reach
// the app server (e.g. internal-only APP_URL). Default to assets shipped under
// public/email/ so local dev works out of the box.
const ZAPDESK_LOGO_URL = process.env.ZAPDESK_LOGO_URL || `${APP_URL}/email/zapdesk-logo.png`;
const KNOWALL_URL = 'https://knowall.ai';

/**
 * The KnowAll AI logo is opt-in, and the footer falls back to a wordmark
 * without it.
 *
 * There is no KnowAll logo asset in this repository — only the ZapDesk one —
 * and a brand mark is not something to approximate. Defaulting the URL to a
 * file that does not exist put an `<img>` into every outbound customer email
 * pointing at nothing: a blank 120x30 gap where the asset is a transparent
 * placeholder, and a broken-image icon if it 404s. A text wordmark is a better
 * outcome than either.
 *
 * Set KNOWALL_LOGO_URL to a hosted copy of the real logo to turn the image on.
 */
const KNOWALL_LOGO_URL = process.env.KNOWALL_LOGO_URL || '';

/**
 * Who an email is for. Customers have no ZapDesk account, so a link into the
 * app only leads them to a sign-in page they cannot get past (#7371). Mail to
 * customers carries no app links; mail to the support team keeps them.
 */
export type EmailAudience = 'customer' | 'team';

/**
 * The shared card layout around every ZapDesk email: logo header, the given
 * content, and the footer. For a `'customer'` audience the logo is not a link
 * into ZapDesk, which customers cannot sign in to (#7371).
 */
export function layoutWrapper(content: string, audience: EmailAudience = 'team'): string {
  const logo = `<img src="${ZAPDESK_LOGO_URL}" width="240" height="60" alt="${APP_NAME}" style="border: 0;" />`;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; color: #18181b; }
    .container { max-width: 600px; margin: 0 auto; padding: 24px; }
    .card { background: #ffffff; border-radius: 12px; padding: 32px 24px; border: 1px solid #e4e4e7; }
    .header { text-align: center; margin-bottom: 24px; }
    .header img { display: block; margin: 0 auto; max-width: 100%; height: auto; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-new { background: #3b82f6; color: #fff; }
    .badge-active { background: #22c55e; color: #fff; }
    .badge-resolved { background: #8b5cf6; color: #fff; }
    .badge-closed { background: #6b7280; color: #fff; }
    .content { margin: 16px 0; line-height: 1.6; }
    .quoted { border-left: 3px solid #d4d4d8; padding-left: 12px; margin: 16px 0; color: #71717a; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #a1a1aa; }
    .footer a { color: #22c55e; text-decoration: none; }
    .footer img { display: block; margin: 8px auto 4px; max-width: 100%; height: auto; }
    .btn { display: inline-block; padding: 12px 24px; background: #22c55e; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; line-height: 1; }
    .meta { font-size: 13px; color: #71717a; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        ${audience === 'team' ? `<a href="${APP_URL}" style="text-decoration: none;">${logo}</a>` : logo}
      </div>
      ${content}
    </div>
    <div class="footer">
      ${
        KNOWALL_LOGO_URL
          ? `<a href="${KNOWALL_URL}" style="text-decoration: none;">
        <img src="${KNOWALL_LOGO_URL}" width="120" height="30" alt="KnowAll AI" style="border: 0;" />
      </a>`
          : ''
      }
      <p style="margin: 4px 0;">Powered by <a href="${KNOWALL_URL}">KnowAll AI</a></p>
      <p style="margin: 4px 0;">Please reply to this email to update your ticket.</p>
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
  return `<span class="badge ${cls}">${escapeText(status)}</span>`;
}

/**
 * First reply to a customer whose email opened a ticket: the ticket number and
 * subject, and that replying adds detail. Carries no link into ZapDesk (#7371).
 */
export function ticketConfirmationTemplate(opts: {
  ticketId: number;
  subject: string;
  requesterName: string;
}): string {
  return layoutWrapper(
    `
    <p>Hi ${escapeText(opts.requesterName || 'there')},</p>
    <div class="content">
      <p>We've received your request and created ticket <strong>#${opts.ticketId}</strong>.</p>
      <p class="meta"><strong>Subject:</strong> ${escapeText(opts.subject)}</p>
      <p>Our team will review your request and get back to you as soon as possible.</p>
      <p>To add more detail, just reply to this email.</p>
    </div>
  `,
    'customer'
  );
}

export interface HistoryEntry {
  authorName: string;
  createdAt: Date;
  contentHtml: string;
}

function renderHistory(history: HistoryEntry[]): string {
  if (!history || history.length === 0) return '';
  const items = history
    .map((h) => {
      const when = h.createdAt.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `
    <div style="border-left: 3px solid #d4d4d8; padding: 8px 12px; margin: 12px 0; color: #52525b; font-size: 13px;">
      <p style="margin: 0 0 6px; color: #71717a; font-size: 12px;">
        <strong>${escapeText(h.authorName)}</strong> · ${when}
      </p>
      <div>${h.contentHtml}</div>
    </div>`;
    })
    .join('');
  return `
    <hr style="margin: 24px 0; border: none; border-top: 1px solid #e4e4e7;" />
    <p class="meta" style="font-size: 12px; color: #71717a; margin-bottom: 4px;">
      Earlier in this conversation:
    </p>
    ${items}`;
}

/**
 * An agent's public reply, as emailed to the customer, with the earlier
 * conversation quoted beneath. Carries no link into ZapDesk (#7371).
 */
export function agentReplyTemplate(opts: {
  ticketId: number;
  agentName: string;
  replyContent: string;
  history?: HistoryEntry[];
}): string {
  return layoutWrapper(
    `
    <p class="meta">${escapeText(opts.agentName)} replied to ticket <strong>#${opts.ticketId}</strong>:</p>
    <div class="content">
      ${opts.replyContent}
    </div>
    ${renderHistory(opts.history || [])}
  `,
    'customer'
  );
}

export function customerReplyNotificationTemplate(opts: {
  ticketId: number;
  ticketSubject: string;
  customerEmail: string;
  replyContentHtml: string;
}): string {
  const ticketUrl = `${APP_URL}/tickets/${opts.ticketId}`;
  return layoutWrapper(`
    <p class="meta">New customer reply on ticket <strong>#${opts.ticketId}</strong></p>
    <p class="meta"><strong>Subject:</strong> ${escapeText(opts.ticketSubject)}</p>
    <p class="meta"><strong>From:</strong> ${escapeText(opts.customerEmail)}</p>
    <div class="content">
      ${opts.replyContentHtml}
    </div>
    <p style="text-align: center; margin-top: 24px;">
      <a href="${ticketUrl}" class="btn">View Ticket #${opts.ticketId}</a>
    </p>
  `);
}

/**
 * Tells the support team someone has left an internal note (7767).
 *
 * An internal note is the one kind of comment that reaches nobody: it is
 * deliberately kept from the customer, and until now that meant it was kept
 * from the rest of the team as well, so a handover written on the ticket sat
 * unread until somebody happened to open it.
 *
 * A team email, and it carries no reply affordance beyond the link: a reply
 * to this would go to the mailbox, not onto the ticket.
 */
export function internalNoteNotificationTemplate(opts: {
  ticketId: number;
  ticketSubject: string;
  authorName: string;
  noteHtml: string;
}): string {
  const ticketUrl = `${APP_URL}/tickets/${opts.ticketId}`;
  return layoutWrapper(`
    <p class="meta">Internal note on ticket <strong>#${opts.ticketId}</strong></p>
    <p class="meta"><strong>Subject:</strong> ${escapeText(opts.ticketSubject)}</p>
    <p class="meta"><strong>From:</strong> ${escapeText(opts.authorName)}</p>
    <div class="content">
      ${opts.noteHtml}
    </div>
    <p class="meta"><em>The customer cannot see this note. Reply on the ticket, not to this email.</em></p>
    <p style="text-align: center; margin-top: 24px;">
      <a href="${ticketUrl}" class="btn">View Ticket #${opts.ticketId}</a>
    </p>
  `);
}

/**
 * Tells the support team a new ticket has arrived by email (#485). A team
 * email, so it keeps its link into ZapDesk.
 */
export function newTicketNotificationTemplate(opts: {
  ticketId: number;
  ticketSubject: string;
  requesterEmail: string;
  project: string;
  messageHtml: string;
}): string {
  const ticketUrl = `${APP_URL}/tickets/${opts.ticketId}`;
  return layoutWrapper(`
    <p class="meta">New ticket <strong>#${opts.ticketId}</strong> has arrived</p>
    <p class="meta"><strong>Subject:</strong> ${escapeText(opts.ticketSubject)}</p>
    <p class="meta"><strong>From:</strong> ${escapeText(opts.requesterEmail)}</p>
    <p class="meta"><strong>Project:</strong> ${escapeText(opts.project)}</p>
    <div class="content">
      ${opts.messageHtml}
    </div>
    <p style="text-align: center; margin-top: 24px;">
      <a href="${ticketUrl}" class="btn">View Ticket #${opts.ticketId}</a>
    </p>
  `);
}

/**
 * Told an engineer a ticket is now theirs.
 *
 * Deliberately short. It exists to get someone's attention and give them a way
 * in; the ticket itself is the place to read the detail, and duplicating it
 * here only means two copies that disagree once anyone replies.
 */
export function assignmentNotificationTemplate(opts: {
  ticketId: number;
  ticketSubject: string;
  assignedByName: string;
  requesterEmail?: string;
}): string {
  const ticketUrl = `${APP_URL}/tickets/${opts.ticketId}`;
  return layoutWrapper(`
    <p class="meta">Ticket <strong>#${opts.ticketId}</strong> has been assigned to you</p>
    <p class="meta"><strong>Subject:</strong> ${escapeText(opts.ticketSubject)}</p>
    ${
      opts.requesterEmail
        ? `<p class="meta"><strong>Raised by:</strong> ${escapeText(opts.requesterEmail)}</p>`
        : ''
    }
    <p class="meta"><strong>Assigned by:</strong> ${escapeText(opts.assignedByName)}</p>
    <p style="text-align: center; margin-top: 24px;">
      <a href="${ticketUrl}" class="btn">View Ticket #${opts.ticketId}</a>
    </p>
  `);
}

/**
 * Tells the customer their ticket moved from one status to another. Carries no
 * link into ZapDesk (#7371).
 */
export function statusChangeTemplate(opts: {
  ticketId: number;
  subject: string;
  requesterName: string;
  oldStatus: string;
  newStatus: string;
}): string {
  return layoutWrapper(
    `
    <p>Hi ${escapeText(opts.requesterName || 'there')},</p>
    <div class="content">
      <p>The status of your ticket <strong>#${opts.ticketId}</strong> has been updated:</p>
      <p style="text-align: center; font-size: 16px;">
        ${statusBadge(opts.oldStatus)} &rarr; ${statusBadge(opts.newStatus)}
      </p>
      <p class="meta"><strong>Subject:</strong> ${escapeText(opts.subject)}</p>
    </div>
  `,
    'customer'
  );
}

export interface TicketFieldChange {
  label: string;
  from: string;
  to: string;
}

/**
 * Told the customer their ticket's title or priority changed (#7724).
 *
 * Status changes have their own email; this covers the other fields a
 * customer can see in their own thread.
 */
export function ticketUpdatedTemplate(opts: {
  ticketId: number;
  subject: string;
  requesterName: string;
  changes: TicketFieldChange[];
}): string {
  const rows = opts.changes
    .map(
      (c) => `
      <tr>
        <td style="padding: 4px 12px 4px 0; color: #71717a; vertical-align: top;"><strong>${escapeText(c.label)}</strong></td>
        <td style="padding: 4px 0;"><span style="color: #71717a; text-decoration: line-through;">${escapeText(c.from || '—')}</span> &rarr; ${escapeText(c.to || '—')}</td>
      </tr>`
    )
    .join('');
  return layoutWrapper(
    `
    <p>Hi ${escapeText(opts.requesterName || 'there')},</p>
    <div class="content">
      <p>Your ticket <strong>#${opts.ticketId}</strong> has been updated:</p>
      <table style="border-collapse: collapse; font-size: 14px; margin: 12px 0;">${rows}
      </table>
      <p class="meta"><strong>Subject:</strong> ${escapeText(opts.subject)}</p>
    </div>
  `,
    'customer'
  );
}
