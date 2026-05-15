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

  // Two categories so we don't drop legitimate content that happens to look
  // like a disclaimer when it appears mid-body.
  //   - "Hard" delimiters always mark end-of-message (RFC 3676 `-- `, mobile
  //     auto-signatures). Take the FIRST occurrence — everything below it is
  //     signature by contract.
  //   - "Soft" matches (DISCLAIMER, "This e-mail is intended", incorporation
  //     boilerplate) can appear in legit content (e.g., a customer asking
  //     about a disclaimer they received). Scan from the bottom and only
  //     cut at the LAST one, so the boilerplate at the very end is removed
  //     but a passing reference in the body is preserved.
  const hardCutPoints: number[] = [];
  const softCutPoints: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // RFC 3676: signature delimiter is "-- " on its own line. Some clients
    // ship "--" without trailing space — accept both.
    if (trimmed === '--' || trimmed === '-- ') {
      hardCutPoints.push(i);
      continue;
    }

    // Common mobile auto-signatures — also reliably at end of message.
    if (
      /^Sent from my (iPhone|iPad|Android|Galaxy|BlackBerry)/i.test(trimmed) ||
      /^Sent from (Outlook|Mail) for (iOS|Android|Windows)/i.test(trimmed) ||
      /^Get Outlook for (iOS|Android)/i.test(trimmed)
    ) {
      hardCutPoints.push(i);
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
      softCutPoints.push(i);
      continue;
    }
  }

  let cutAt: number | null = null;
  if (hardCutPoints.length > 0) {
    cutAt = hardCutPoints[0];
  } else if (softCutPoints.length > 0) {
    cutAt = softCutPoints[softCutPoints.length - 1];
  }
  if (cutAt === null) return body.trim();

  return lines.slice(0, cutAt).join('\n').trimEnd();
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

/**
 * Strip dangerous markup from an inbound email HTML body before embedding it
 * in a DevOps work item field. Best-effort regex sanitiser — DevOps applies
 * its own sanitiser when rendering, this is defence-in-depth.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  return (
    html
      // Drop entire script/style/iframe/object/embed/link/meta blocks (with content).
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
      .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '')
      .replace(/<embed\b[^>]*\/?>/gi, '')
      .replace(/<link\b[^>]*\/?>/gi, '')
      .replace(/<meta\b[^>]*\/?>/gi, '')
      // Strip inline event handlers (`onclick=...`, `onload=...`, ...).
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      // Neutralise javascript: and data: (non-image) URLs.
      .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
      .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'")
  );
}

/**
 * Best-effort signature stripping for HTML email bodies. We can't use the
 * line-based `stripSignature` directly — HTML emails are usually a single
 * blob with `<br>` separators, not `\n`. Cut at the first reliable end-of-
 * message marker we find.
 */
export function stripHtmlSignature(html: string): string {
  if (!html) return '';

  // Common hard markers — RFC 3676 delimiter rendered as HTML, mobile auto-
  // sigs, gmail/outlook signature blocks. Take the FIRST occurrence: anything
  // below it is signature.
  const hardMarkers: RegExp[] = [
    /<div[^>]*class="[^"]*gmail_signature[^"]*"[^>]*>/i,
    /<div[^>]*id="Signature"[^>]*>/i,
    /<div[^>]*class="[^"]*moz-signature[^"]*"[^>]*>/i,
    /(?:<br\s*\/?>\s*){1,3}--\s*(?:<br\s*\/?>|<\/?p>|<\/div>)/i,
    /(?:<br\s*\/?>|<p>|<div[^>]*>)\s*Sent from my (?:iPhone|iPad|Android|Galaxy|BlackBerry)/i,
    /(?:<br\s*\/?>|<p>|<div[^>]*>)\s*Sent from (?:Outlook|Mail) for (?:iOS|Android|Windows)/i,
    /(?:<br\s*\/?>|<p>|<div[^>]*>)\s*Get Outlook for (?:iOS|Android)/i,
  ];

  let cutAt = html.length;
  for (const re of hardMarkers) {
    const match = re.exec(html);
    if (match && match.index < cutAt) cutAt = match.index;
  }
  return cutAt < html.length ? html.slice(0, cutAt).trimEnd() : html;
}

/**
 * Replace `cid:CONTENT_ID` references in `<img src="...">` tags with the
 * URLs the matching files were uploaded to. Outlook and Gmail mark pasted
 * screenshots as inline `cid:` images; without rewriting, the body shows a
 * broken-image icon in DevOps.
 */
export function rewriteCidReferences(
  html: string,
  cidMap: Map<string, { url: string; filename: string }>
): string {
  if (!html || cidMap.size === 0) return html;
  return html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])cid:([^"'>\s]+)\2/gi,
    (full, prefix: string, quote: string, cid: string) => {
      const target = cidMap.get(cid) || cidMap.get(cid.toLowerCase());
      if (!target) return full;
      return `${prefix}${quote}${escapeHtml(target.url)}${quote} alt="${escapeHtml(target.filename)}"`;
    }
  );
}

/**
 * Sanitise + signature-strip + truncate an HTML email body for safe storage
 * in a DevOps work item. Mirror of `renderEmailBody` for the HTML path.
 */
export function renderEmailBodyHtml(rawHtml: string): string {
  const sanitised = sanitizeEmailHtml(rawHtml);
  const stripped = stripHtmlSignature(sanitised);
  const truncated =
    stripped.length > MAX_BODY_CHARS
      ? stripped.slice(0, MAX_BODY_CHARS) + '<p><em>[truncated]</em></p>'
      : stripped;
  if (!truncated.replace(/<[^>]+>/g, '').trim()) return '<em>No content</em>';
  return `<div style="font-family: inherit;">${truncated}</div>`;
}
