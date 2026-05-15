/**
 * Microsoft Graph mailbox polling for inbound email.
 *
 * Replaces the more brittle change-notification subscription approach: every
 * call lists unread Inbox messages, ingests each one, then marks it read so it
 * isn't re-processed. Wire this up to a 1-minute cron (GitHub Actions, Azure
 * WebJob, ...) and customers raising tickets by email get a confirmation
 * within ~60 seconds of sending.
 *
 * Required Graph permissions on the mail Azure AD app:
 *   - `Mail.ReadWrite` (Application) — read + flag-as-read
 *   - `Mail.Send` (Application) — outbound from `email.ts`
 * Both should be scoped via Application Access Policy to the support mailbox.
 */

import { getMailGraphToken } from './email';
import { ingestEmail, type IngestEmailAttachment, type IngestResult } from './email-ingest';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

// Cap per poll so a backlog can't time out the cron call. With a 1-minute
// schedule even 25 / minute = 1500 / hour which is plenty for B2B support.
const MAX_PER_POLL = 25;

interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  /** Only the new content of the message, with quoted thread stripped by Graph. */
  uniqueBody?: { contentType: string; content: string };
  hasAttachments?: boolean;
  receivedDateTime?: string;
}

interface GraphAttachment {
  '@odata.type': string;
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
  /** Present on `#microsoft.graph.fileAttachment`. */
  contentBytes?: string;
  /** Present on `#microsoft.graph.referenceAttachment`. */
  sourceUrl?: string;
  /** Microsoft Graph sometimes exposes a direct download for reference attachments. */
  '@microsoft.graph.downloadUrl'?: string;
  /** Present on `#microsoft.graph.itemAttachment`. */
  item?: { subject?: string };
}

export interface PollSummary {
  mailbox: string;
  fetched: number;
  ingested: number;
  failed: number;
  results: Array<{
    messageId: string;
    subject?: string;
    result: IngestResult;
  }>;
}

export function pollMailboxFromEnv(): string | null {
  return process.env.MAIL_POLL_MAILBOX || null;
}

export async function pollMailbox(mailbox: string): Promise<PollSummary> {
  const token = await getMailGraphToken();
  const messages = await listUnread(token, mailbox);

  const summary: PollSummary = {
    mailbox,
    fetched: messages.length,
    ingested: 0,
    failed: 0,
    results: [],
  };

  for (const message of messages) {
    const fromAddress = message.from?.emailAddress?.address;
    if (!fromAddress) {
      console.warn(`[Poll] message ${message.id} has no from address — marking read`);
      await markRead(token, mailbox, message.id);
      summary.failed += 1;
      summary.results.push({
        messageId: message.id,
        subject: message.subject,
        result: { success: false, status: 400, error: 'No from address' },
      });
      continue;
    }

    const fromName = message.from?.emailAddress?.name;
    const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

    let attachments: IngestEmailAttachment[] | undefined;
    if (message.hasAttachments) {
      try {
        attachments = await fetchAttachments(token, mailbox, message.id);
      } catch (err) {
        console.warn(`[Poll] failed to fetch attachments for ${message.id}:`, err);
      }
    }

    const result = await ingestEmail({
      from,
      subject: message.subject || '(no subject)',
      body: message.uniqueBody?.content || '',
      bodyType: message.uniqueBody?.contentType === 'html' ? 'html' : 'text',
      attachments,
    });

    if (result.success) {
      // Only mark read on success so retries pick the message up next poll.
      await markRead(token, mailbox, message.id);
      summary.ingested += 1;
    } else {
      summary.failed += 1;
      console.error(
        `[Poll] ingest failed for message ${message.id} (${message.subject}): ${result.error}`
      );
      // Leave the message unread — operator can investigate, next run retries.
    }

    summary.results.push({ messageId: message.id, subject: message.subject, result });
  }

  if (summary.fetched > 0) {
    console.log(
      `[Poll] ${mailbox}: fetched=${summary.fetched} ingested=${summary.ingested} failed=${summary.failed}`
    );
  }
  return summary;
}

async function listUnread(token: string, mailbox: string): Promise<GraphMessage[]> {
  // Newest-first: ensures freshly arrived mail is always within the page even
  // when older unread messages can't be ingested (e.g. spam, system notifications,
  // domains that don't map to a project) and stay unread forever.
  const url =
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/mailFolders('Inbox')/messages` +
    `?$filter=isRead eq false` +
    `&$select=id,subject,from,uniqueBody,hasAttachments,receivedDateTime` +
    `&$orderby=receivedDateTime desc` +
    `&$top=${MAX_PER_POLL}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // HTML so `<img src="cid:...">` references survive — we rewrite them
      // post-upload to keep pasted screenshots inline. The body is sanitised
      // and signature-stripped in `email-clean.ts` before storage.
      Prefer: 'outlook.body-content-type="html"',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph list-messages failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { value?: GraphMessage[] };
  return json.value || [];
}

async function fetchAttachments(
  token: string,
  mailbox: string,
  messageId: string
): Promise<IngestEmailAttachment[]> {
  // `$expand=microsoft.graph.itemAttachment/item` is required for forwarded
  // .eml previews to include the inner message subject; without it `item` is
  // null and we can't surface a useful note.
  const url =
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments` +
    `?$expand=microsoft.graph.itemAttachment/item`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Graph list-attachments failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { value?: GraphAttachment[] };
  const result: IngestEmailAttachment[] = [];

  for (const a of json.value || []) {
    const filename = a.name || `attachment-${a.id}`;
    const contentType = a.contentType || 'application/octet-stream';

    switch (a['@odata.type']) {
      case '#microsoft.graph.fileAttachment': {
        if (!a.contentBytes) {
          console.warn(
            `[Poll] fileAttachment ${a.id} (${filename}) has no contentBytes — skipping`
          );
          continue;
        }
        // Inline files (pasted screenshots, signature images) are kept: the
        // body fetch is HTML now, so `<img src="cid:...">` references can be
        // rewritten to point at the uploaded DevOps URL.
        result.push({
          filename,
          contentType,
          content: a.contentBytes,
          contentId: a.contentId || undefined,
          isInline: Boolean(a.isInline),
        });
        break;
      }
      case '#microsoft.graph.referenceAttachment': {
        // Outlook converts files >35 MB (and any file when "Modern Attachments"
        // is enabled) to OneDrive / SharePoint links. Try the direct download
        // URL when Graph exposes it; otherwise surface the source URL so the
        // agent can click through.
        const downloadUrl = a['@microsoft.graph.downloadUrl'];
        const sourceUrl = a.sourceUrl;
        if (downloadUrl) {
          try {
            const fileRes = await fetch(downloadUrl);
            if (fileRes.ok) {
              const buf = Buffer.from(await fileRes.arrayBuffer());
              result.push({
                filename,
                contentType,
                content: buf.toString('base64'),
                referenceUrl: sourceUrl,
              });
              break;
            }
            console.warn(
              `[Poll] referenceAttachment ${a.id} (${filename}) downloadUrl returned ${fileRes.status} — falling back to link`
            );
          } catch (err) {
            console.warn(
              `[Poll] referenceAttachment ${a.id} (${filename}) download failed — falling back to link:`,
              err
            );
          }
        }
        if (sourceUrl) {
          result.push({ filename, contentType, referenceUrl: sourceUrl });
        } else {
          console.warn(
            `[Poll] referenceAttachment ${a.id} (${filename}) has no sourceUrl — skipping`
          );
        }
        break;
      }
      case '#microsoft.graph.itemAttachment': {
        // Forwarded .eml — Graph won't give us bytes through this endpoint, so
        // record a tagged note so the message doesn't vanish silently. A
        // future change can fetch the inner MIME and re-ingest.
        result.push({
          filename,
          contentType,
          itemSubject: a.item?.subject || filename,
        });
        break;
      }
      default: {
        console.warn(`[Poll] unknown attachment type ${a['@odata.type']} (${filename}) — skipping`);
      }
    }
  }
  return result;
}

async function markRead(token: string, mailbox: string, messageId: string): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isRead: true }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    // Don't throw — failing to flag-as-read just means we'll re-process the
    // message next poll. Worst case is a duplicate ticket; better than
    // dropping the entire poll.
    console.warn(`[Poll] failed to mark ${messageId} read (${res.status}): ${text}`);
  }
}
