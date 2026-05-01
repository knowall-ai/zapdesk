/**
 * Email body sanitisation for inbound mail.
 *
 * Inputs: plain-text `uniqueBody` from Microsoft Graph (already strips the
 * quoted thread from previous messages in the conversation).
 * Outputs: trimmed text with signatures and confidentiality notices removed,
 * then HTML-escaped and wrapped for safe DevOps storage.
 */

const MAX_BODY_CHARS = 50_000;

/** Strip common signature blocks from the tail of a plain-text email body. */
export function stripSignature(body: string): string {
  if (!body) return '';

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const cutPoints: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // RFC 3676: signature delimiter is "-- " on its own line. Some clients
    // ship "--" without trailing space — accept both.
    if (trimmed === '--' || trimmed === '-- ') {
      cutPoints.push(i);
      continue;
    }

    // Common mobile auto-signatures
    if (
      /^Sent from my (iPhone|iPad|Android|Galaxy|BlackBerry)/i.test(trimmed) ||
      /^Sent from (Outlook|Mail) for (iOS|Android|Windows)/i.test(trimmed) ||
      /^Get Outlook for (iOS|Android)/i.test(trimmed)
    ) {
      cutPoints.push(i);
      continue;
    }

    // Confidentiality / disclaimer notices — usually all-caps headings or
    // long boilerplate paragraphs at the end of corporate mail.
    if (
      /^(CONFIDENTIAL(ITY)?( NOTICE)?|DISCLAIMER|PRIVILEGED AND CONFIDENTIAL|NOTICE:)\s*[:.\-]?\s*$/i.test(
        trimmed
      ) ||
      /^This (e-?mail|message) (and any|is intended|may contain)/i.test(trimmed) ||
      /is a limited company incorporated in/i.test(trimmed)
    ) {
      cutPoints.push(i);
      continue;
    }
  }

  if (cutPoints.length === 0) return body.trim();

  // Keep only what's above the earliest cut point.
  const cleaned = lines.slice(0, cutPoints[0]).join('\n').trimEnd();
  return cleaned;
}

/** HTML-escape user input before embedding in DevOps fields. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Clean + escape + wrap a plain-text email body for safe HTML storage. */
export function renderEmailBody(rawText: string): string {
  const stripped = stripSignature(rawText);
  const truncated =
    stripped.length > MAX_BODY_CHARS
      ? stripped.slice(0, MAX_BODY_CHARS) + '\n\n[truncated]'
      : stripped;
  if (!truncated.trim()) return '<em>No content</em>';
  return `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${escapeHtml(
    truncated
  )}</pre>`;
}
