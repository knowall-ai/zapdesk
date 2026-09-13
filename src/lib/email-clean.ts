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
  const stripped = stripHtmlSignature(sanitised);
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
