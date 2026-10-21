/**
 * Email body sanitisation for inbound mail.
 *
 * Inputs: `uniqueBody` from Microsoft Graph. That is meant to leave out the
 * quoted thread, but for mail from outside the tenant (Gmail, for one) it
 * often keeps it, so the quoted ZapDesk email is cut here too (#7720).
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

/**
 * True for a quoted block that is ZapDesk's own email: every message ZapDesk
 * sends carries its name or logo, a `[ZapDesk #N]` subject or ticket link, or
 * the support address. Only ever given one quote block and its attribution,
 * never the rest of the body, so a later ZapDesk quote can't qualify an
 * earlier unrelated one.
 */
function isZapDeskQuote(block: string): boolean {
  if (/zapdesk/i.test(block)) return true;
  const mailbox = (process.env.MAIL_POLL_MAILBOX || process.env.MAIL_FROM || '').trim();
  return mailbox !== '' && block.toLowerCase().includes(mailbox.toLowerCase());
}

/** "On <date>, <sender> wrote:", in English or the trailing-colon form other languages use. */
const ATTRIBUTION_LINE = /^(On .{4,200}wrote:|.{0,200}wrote:|.{0,200}@.{0,200}:)$/i;

/**
 * Cut quoted ZapDesk email from a plain-text reply (#7720).
 *
 * A quote is a run of `>` lines with the attribution line just above it; it
 * is removed when that run is ZapDesk's email, and the text around it stays.
 * An "-----Original Message-----" header (Outlook) quotes everything below
 * it, so it is cut to the end when its header block names ZapDesk.
 */
export function stripQuotedText(body: string): string {
  if (!body) return '';
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line)) {
      // Judged on its header fields only, not the quoted message below.
      if (isZapDeskQuote(headerFields(lines.slice(i + 1)))) break;
    }

    if (line.startsWith('>')) {
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].trim().startsWith('>')) end++;
      const previous = kept.length > 0 ? kept[kept.length - 1].trim() : '';
      const hasAttribution = ATTRIBUTION_LINE.test(previous);
      const block = [hasAttribution ? previous : '', ...lines.slice(i, end + 1)].join('\n');
      if (isZapDeskQuote(block)) {
        if (hasAttribution) kept.pop();
        i = end;
        continue;
      }
    }

    kept.push(lines[i]);
  }
  return kept.join('\n').trimEnd();
}

const HEADER_FIELD = /^\s*(From|Sent|Date|To|Cc|Subject)\s*:/i;

/**
 * The From/Sent/To/Subject lines at the top of an Outlook quote, and none of
 * the quoted message: deciding on those alone keeps a supplier's quoted email
 * that merely mentions ZapDesk in its body.
 */
function headerFields(lines: string[]): string {
  const fields: string[] = [];
  for (const line of lines) {
    if (HEADER_FIELD.test(line)) fields.push(line);
    else if (line.trim() !== '' && fields.length > 0) break;
  }
  return fields.join('\n');
}

/** The text lines of an HTML fragment, for reading its header fields. */
function htmlLines(fragment: string): string[] {
  return fragment
    .replace(/<br\s*\/?>|<\/(?:p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .split('\n');
}

/** Where the element opened at `start` closes (after its end tag), counting nested ones. */
function elementEnd(html: string, start: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return html.length;
}

/**
 * Where the attribution line before `index` starts: the last block whose
 * text ends with ":" and names a sender (an address, or "wrote"). `index`
 * when there is none.
 */
function attributionStart(html: string, index: number): number {
  const before = html.slice(0, index);
  const lastBlock = Math.max(before.lastIndexOf('<div'), before.lastIndexOf('<p'));
  if (lastBlock === -1) return index;
  const text = before
    .slice(lastBlock)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;|&gt;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /:$/.test(text) && (/@/.test(text) || /wrote/i.test(text)) && text.length < 300
    ? lastBlock
    : index;
}

/**
 * Cut quoted ZapDesk email from an HTML reply (#7720).
 *
 * Gmail puts the earlier message in a `<blockquote>` after an attribution
 * line ("On <date>, Support <address> wrote:", in the sender's language), and
 * Graph strips the `gmail_quote` class that would have marked it. Each quote
 * container is judged on its own content and attribution, and removed only
 * when it is ZapDesk's email; the text around it stays.
 *
 * Outlook quotes everything below a `divRplyFwdMsg` / `appendonsend` header
 * block, a `stopSpelling` rule or "-----Original Message-----", so those are
 * cut to the end when their header block names ZapDesk.
 */
export function stripQuotedHtml(html: string): string {
  if (!html) return '';
  let out = html;

  // Quote containers, innermost first. A container is judged once everything
  // nested in it has been: on its own text and attribution, without the
  // quotes inside it that were kept. A ZapDesk quote inside an unrelated one
  // goes and the outer one stays; a ZapDesk email that itself quotes
  // something goes whole. Kept containers are marked while this runs.
  const KEPT = 'data-zapdesk-kept';
  const container =
    /<(blockquote)\b(?![^>]*data-zapdesk-kept)[^>]*>|<(div)\b(?![^>]*data-zapdesk-kept)[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>/gi;
  const keptElement = /<(blockquote|div)\b[^>]*data-zapdesk-kept[^>]*>/gi;
  for (;;) {
    const ranges = [...out.matchAll(container)].map((m) => {
      const start = m.index ?? 0;
      return { start, end: elementEnd(out, start, (m[1] || m[2]).toLowerCase()) };
    });
    const ready = ranges.filter(
      (r) => !ranges.some((o) => o !== r && o.start > r.start && o.end <= r.end)
    );
    if (ready.length === 0) break;
    // From the last, so earlier positions stay valid as text changes.
    for (const quote of ready.reverse()) {
      const from = attributionStart(out, quote.start);
      let own = out.slice(from, quote.end);
      for (const kept of [...own.matchAll(keptElement)].reverse()) {
        const at = kept.index ?? 0;
        own = own.slice(0, at) + own.slice(elementEnd(own, at, kept[1].toLowerCase()));
      }
      if (isZapDeskQuote(own)) {
        out = out.slice(0, from) + out.slice(quote.end);
      } else {
        const tagEnd = out.indexOf('>', quote.start);
        const selfClosing = out[tagEnd - 1] === '/';
        const at = selfClosing ? tagEnd - 1 : tagEnd;
        out = `${out.slice(0, at)} ${KEPT}${out.slice(at)}`;
      }
    }
  }
  out = out.replace(/ data-zapdesk-kept/g, '');

  // Outlook headers: everything below them is the earlier message.
  const header =
    /<div[^>]*id="?(?:divRplyFwdMsg|appendonsend)"?[^>]*>|<hr[^>]*id="?stopSpelling"?[^>]*>|-{2,}\s*Original Message\s*-{2,}/gi;
  for (const match of out.matchAll(header)) {
    const start = match.index ?? 0;
    // Judged on the From/Sent/To/Subject fields only, not the quoted message.
    const fields = headerFields(htmlLines(out.slice(start + match[0].length, start + 2000)));
    if (isZapDeskQuote(fields)) {
      out = out.slice(0, attributionStart(out, start));
      break;
    }
  }

  return out.trimEnd();
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
  const stripped = stripSignature(stripQuotedText(rawText));
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
      // Neutralise script-bearing URLs, quoted or bare. `data:` is allowed
      // through only for images, which is how Outlook embeds pasted
      // screenshots; every other media type can carry markup.
      //
      // The scheme is judged on the *decoded* value. Matching the literal text
      // missed `href="jav&#x61;script:alert(1)"` — the entity is decoded by the
      // parser long after this runs, so the string checks saw "jav&#x61;script"
      // and let it through.
      //
      // Still best-effort by design: this is a regex over untrusted markup, so
      // an attacker with enough encoding tricks can get past it. It is
      // defence-in-depth ahead of the render-time sanitisers — ZapDesk's own,
      // and DevOps's — not a substitute for them.
      .replace(
        /\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (match, attr: string, dq?: string, sq?: string, bare?: string) => {
          const raw = dq ?? sq ?? bare ?? '';
          return isDangerousUrl(raw) ? `${attr}="#"` : match;
        }
      )
  );
}

/**
 * Decode the HTML entities a URL scheme can hide behind.
 *
 * Only enough to judge the scheme: numeric and hex character references plus
 * the handful of named ones that appear in obfuscated payloads. This is not a
 * general entity decoder and its output is never rendered — it exists solely
 * so the scheme test below sees what the browser's parser will see.
 */
function decodeForSchemeCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16) || 0)
    )
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10) || 0))
    .replace(/&colon;?/gi, ':')
    .replace(/&Tab;?/gi, '\t')
    .replace(/&NewLine;?/gi, '\n');
}

/**
 * True when an attribute value resolves to a scheme that must not survive.
 *
 * Whitespace and control characters are stripped before testing because the
 * HTML parser ignores them inside a scheme: `java\tscript:` and `java\nscript:`
 * both navigate.
 */
function isDangerousUrl(value: string): boolean {
  const normalised = decodeForSchemeCheck(value)
    .replace(/[\s\u0000-\u001f]/g, '')
    .toLowerCase();
  if (/^(javascript|vbscript):/.test(normalised)) return true;
  // `data:` carries markup for every type except images.
  return normalised.startsWith('data:') && !normalised.startsWith('data:image/');
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
    // Gmail writes the RFC 3676 delimiter as its own span: <span>-- </span><br>
    /<span[^>]*>\s*--\s*<\/span>\s*<br\s*\/?>/i,
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
 * The `cid:` content ids an HTML body actually references from an `<img>` tag.
 *
 * Used to tell an inline file that was spliced into the body from one that was
 * not: a plain-text body splices nothing, and an HTML body can carry a
 * `contentId` it never references. Either way the file has to be surfaced
 * somewhere or it is invisible to the reader.
 *
 * Ids are lower-cased, matching how `rewriteCidReferences` looks them up.
 */
export function collectReferencedCids(html: string): Set<string> {
  const found = new Set<string>();
  if (!html) return found;
  const pattern = /<img\b[^>]*?\bsrc\s*=\s*(["'])cid:([^"'>\s]+)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    found.add(match[2].toLowerCase());
  }
  return found;
}

/**
 * Truncate HTML without cutting through a tag.
 *
 * Slicing the raw string at a character count lands wherever it lands. A
 * 60,000-character data-URL image cut mid-attribute left an unterminated
 * `<img src="...`, which destroys that image and swallows the markup after it
 * as the parser keeps looking for a closing quote.
 *
 * Backing up to the last tag boundary keeps the output parseable. The partial
 * element is dropped whole rather than emitted broken -- content is lost
 * either way at this point, and losing it cleanly is the difference between
 * one missing image and a mangled rest-of-body.
 *
 * Elements left open by the cut are not closed here; the render-time
 * sanitiser parses and reserialises, which balances them.
 */
function truncateHtml(html: string, max: number): string {
  if (html.length <= max) return html;
  const head = html.slice(0, max);
  const lastOpen = head.lastIndexOf('<');
  const lastClose = head.lastIndexOf('>');
  // An unmatched "<" after the last ">" means the cut landed inside a tag.
  const safe = lastOpen > lastClose ? head.slice(0, lastOpen) : head;
  return safe + '<p><em>[truncated]</em></p>';
}

/**
 * Sanitise + signature-strip + truncate an HTML email body for safe storage
 * in a DevOps work item. Mirror of `renderEmailBody` for the HTML path.
 */
export function renderEmailBodyHtml(rawHtml: string): string {
  const sanitised = sanitizeEmailHtml(rawHtml);
  const stripped = stripHtmlSignature(stripQuotedHtml(sanitised));
  const truncated = truncateHtml(stripped, MAX_BODY_CHARS);
  // A screenshot-only email has no text nodes at all. Testing text alone threw
  // away the inline image that rewriteCidReferences had just spliced in, and
  // replaced the whole body with "No content" — so embedded media counts as
  // content in its own right.
  const hasText = truncated.replace(/<[^>]+>/g, '').trim().length > 0;
  const hasMedia = /<img\b/i.test(truncated);
  if (!hasText && !hasMedia) return '<em>No content</em>';
  return `<div style="font-family: inherit;">${truncated}</div>`;
}
