/**
 * Turning DevOps attachments into something a mail client can render.
 *
 * An image pasted into a reply is uploaded to the work item and referenced in
 * the stored comment by ZapDesk's own proxy URL:
 *
 *     <img src="/api/devops/attachments/<id>?fileName=shot.png&org=KnowAll" />
 *
 * That is right for the browser and useless in an email. The path is relative,
 * so it resolves against nothing; and even made absolute it needs a signed-in
 * ZapDesk session, which a customer reading their inbox does not have. They saw
 * a broken image where the screenshot should be (#7376).
 *
 * The fix is to send the bytes rather than a link to them: rewrite each `src`
 * to a `cid:` reference and carry the file itself on the message.
 */

/** A file to send with an outbound message. */
export interface OutboundAttachment {
  /** DevOps attachment id, used to fetch the bytes. */
  id: string;
  /** Name shown in the mail client. */
  fileName: string;
  /** Matches the `cid:` in the rewritten HTML. */
  contentId: string;
}

export interface InlineRewrite {
  html: string;
  attachments: OutboundAttachment[];
}

/** Proxy URLs this app emits, absolute or relative, with any query order. */
const PROXY_SRC =
  /src=(["'])((?:https?:\/\/[^"']*)?\/api\/devops\/attachments\/([^"'?]+)[^"']*)\1/gi;

function fileNameFrom(url: string, fallback: string): string {
  const match = /[?&]fileName=([^&"']+)/i.exec(url);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed escape is not worth failing a whole email over.
    return match[1];
  }
}

/**
 * Replace proxy image references with `cid:` and list what must be attached.
 *
 * Only ZapDesk proxy URLs are touched. An image the sender embedded from
 * somewhere public is already reachable and is left exactly as it is —
 * rewriting it would break a working image to fix one that is not.
 *
 * The same attachment referenced twice is carried once: mail clients key on
 * the content id, and duplicating the bytes only inflates the message.
 */
export function inlineProxyImages(html: string): InlineRewrite {
  const attachments: OutboundAttachment[] = [];
  const seen = new Map<string, string>();

  const rewritten = html.replace(PROXY_SRC, (whole, quote, url, rawId) => {
    const id = decodeURIComponent(rawId);
    const existing = seen.get(id);
    if (existing) return `src=${quote}cid:${existing}${quote}`;

    const fileName = fileNameFrom(url, `image-${attachments.length + 1}`);
    // Domain-shaped so clients that expect an addr-spec do not discard it.
    const contentId = `zapdesk-${attachments.length + 1}-${id}@zapdesk`;
    seen.set(id, contentId);
    attachments.push({ id, fileName, contentId });
    return `src=${quote}cid:${contentId}${quote}`;
  });

  return { html: rewritten, attachments };
}
