/**
 * Email service for ZapDesk.
 * Handles outbound email sending via SMTP (nodemailer).
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  ticketConfirmationTemplate,
  agentReplyTemplate,
  statusChangeTemplate,
} from './email-templates';

let transporter: Transporter | null = null;

/** Check whether SMTP is configured via environment variables. */
export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

/** Get or create the nodemailer SMTP transporter (singleton). */
function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (!isSmtpConfigured()) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD.');
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  return transporter;
}

// ---------------------------------------------------------------------------
// Tag helpers — requester email is stored as a tag: email-from:user@domain.com
// ---------------------------------------------------------------------------

/** Check if a work item is an email-created ticket by looking at its tags. */
export function isEmailTicket(tags: string | string[]): boolean {
  const tagStr = Array.isArray(tags) ? tags.join('; ') : tags;
  return tagStr.toLowerCase().includes('email');
}

/** Extract the requester email from the `email-from:` tag. */
export function extractRequesterEmail(tags: string | string[]): string | null {
  const tagList = Array.isArray(tags) ? tags : tags.split(';').map((t) => t.trim());

  for (const tag of tagList) {
    const trimmed = tag.trim();
    if (trimmed.toLowerCase().startsWith('email-from:')) {
      return trimmed.slice('email-from:'.length).trim();
    }
  }
  return null;
}

/** Extract a display name from an email address (part before @). */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0];
  // Turn "john.doe" or "john_doe" into "John Doe"
  return local.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Threading helpers
// ---------------------------------------------------------------------------

const SMTP_DOMAIN = process.env.SMTP_FROM?.split('@')[1] || 'zapdesk.local';

/** Generate a deterministic Message-ID for a ticket email. */
export function generateMessageId(ticketId: number, suffix?: string): string {
  const part = suffix ? `${ticketId}-${suffix}` : `${ticketId}-${Date.now()}`;
  return `<zapdesk-${part}@${SMTP_DOMAIN}>`;
}

/** Build threading headers so email clients group messages together. */
function threadingHeaders(ticketId: number, originalMessageId?: string) {
  const headers: Record<string, string> = {};
  if (originalMessageId) {
    headers['In-Reply-To'] = originalMessageId;
    headers['References'] = originalMessageId;
  }
  return headers;
}

/** Prefix a subject with the ticket reference for threading. */
function threadedSubject(ticketId: number, subject: string): string {
  const prefix = `[ZapDesk #${ticketId}]`;
  if (subject.includes(prefix)) return subject;
  return `${prefix} ${subject}`;
}

// ---------------------------------------------------------------------------
// Send functions (fire-and-forget safe — log errors, never throw)
// ---------------------------------------------------------------------------

const fromAddress = () => {
  const name = process.env.SMTP_FROM_NAME || 'ZapDesk Support';
  const addr = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  return `"${name}" <${addr}>`;
};

/** Send a ticket confirmation email to the requester. */
export async function sendTicketConfirmation(
  ticketId: number,
  subject: string,
  requesterEmail: string
): Promise<string | null> {
  if (!isSmtpConfigured()) return null;
  try {
    const messageId = generateMessageId(ticketId, 'created');
    const html = ticketConfirmationTemplate({
      ticketId,
      subject,
      requesterName: nameFromEmail(requesterEmail),
    });

    await getTransporter().sendMail({
      from: fromAddress(),
      to: requesterEmail,
      subject: threadedSubject(ticketId, subject),
      html,
      messageId,
    });

    console.log(`[Email] Confirmation sent for ticket #${ticketId} to ${requesterEmail}`);
    return messageId;
  } catch (error) {
    console.error(`[Email] Failed to send confirmation for ticket #${ticketId}:`, error);
    return null;
  }
}

/** Send an agent reply email to the requester. */
export async function sendAgentReply(
  ticketId: number,
  subject: string,
  requesterEmail: string,
  agentName: string,
  replyHtml: string,
  originalMessageId?: string
): Promise<void> {
  if (!isSmtpConfigured()) return;
  try {
    const messageId = generateMessageId(ticketId);
    const html = agentReplyTemplate({
      ticketId,
      agentName,
      replyContent: replyHtml,
    });

    await getTransporter().sendMail({
      from: fromAddress(),
      to: requesterEmail,
      subject: threadedSubject(ticketId, `Re: ${subject}`),
      html,
      messageId,
      headers: threadingHeaders(ticketId, originalMessageId),
    });

    console.log(`[Email] Agent reply sent for ticket #${ticketId} to ${requesterEmail}`);
  } catch (error) {
    console.error(`[Email] Failed to send agent reply for ticket #${ticketId}:`, error);
  }
}

/** Send a status change notification email to the requester. */
export async function sendStatusChangeNotification(
  ticketId: number,
  subject: string,
  requesterEmail: string,
  oldStatus: string,
  newStatus: string,
  originalMessageId?: string
): Promise<void> {
  if (!isSmtpConfigured()) return;
  try {
    const messageId = generateMessageId(ticketId);
    const html = statusChangeTemplate({
      ticketId,
      subject,
      requesterName: nameFromEmail(requesterEmail),
      oldStatus,
      newStatus,
    });

    await getTransporter().sendMail({
      from: fromAddress(),
      to: requesterEmail,
      subject: threadedSubject(ticketId, `Re: ${subject}`),
      html,
      messageId,
      headers: threadingHeaders(ticketId, originalMessageId),
    });

    console.log(
      `[Email] Status change notification sent for ticket #${ticketId} to ${requesterEmail}`
    );
  } catch (error) {
    console.error(
      `[Email] Failed to send status change notification for ticket #${ticketId}:`,
      error
    );
  }
}
