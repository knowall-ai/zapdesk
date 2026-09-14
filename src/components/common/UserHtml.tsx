'use client';

import { rewriteAttachmentUrls } from '@/lib/attachment-utils';
import { sanitizeUserHtml } from '@/lib/sanitize-html';

interface UserHtmlProps {
  /** Raw work item HTML straight from Azure DevOps. */
  html: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  /** Render as something other than a div — e.g. `p` inside a card. */
  as?: 'div' | 'p' | 'span';
  /** Highlight `@mentions`. Comment bodies only, not descriptions. */
  mentions?: boolean;
}

/**
 * The single place ZapDesk renders Azure DevOps HTML into the DOM.
 *
 * Descriptions, repro steps, resolutions and comments are stored as HTML
 * upstream, so they have to be rendered as markup — which makes each render
 * site an injection sink. There were eleven of them, each calling
 * `dangerouslySetInnerHTML` directly, and none sanitising (issue #413).
 *
 * Funnelling them through one component means the sanitiser cannot be
 * forgotten at a new call site: the next person to render comment HTML reaches
 * for this instead of the raw attribute.
 *
 * Attachment URLs are rewritten to the proxy first, then the result is
 * sanitised — sanitising last so nothing the rewrite produces escapes it.
 */
export default function UserHtml({
  html,
  className,
  style,
  as = 'div',
  mentions = false,
}: UserHtmlProps) {
  const Tag = as;
  const __html = sanitizeUserHtml(rewriteAttachmentUrls(html ?? ''), { mentions });
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html }} />;
}
