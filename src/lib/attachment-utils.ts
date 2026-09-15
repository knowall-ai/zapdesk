import { MAX_ATTACHMENT_SIZE, ALLOWED_ATTACHMENT_TYPES } from '@/types';

/**
 * Format file size in human-readable format.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate a file against size and type constraints.
 * Returns an error message if invalid, or null if valid.
 */
export function validateFile(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return `File "${file.name}" is too large. Maximum size is ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB`;
  }

  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
    return `File "${file.name}" type is not allowed. Supported: images, PDFs, Office docs, text files, ZIP.`;
  }

  return null;
}
/** Matches a DevOps attachment URL and captures the org and the attachment GUID. */
const DEVOPS_ATTACHMENT_URL =
  /https?:\/\/(?:dev\.azure\.com\/([^/\s"']+)|([^/\s"'.]+)\.visualstudio\.com)\/[^"'\s]*?\/_apis\/wit\/attachments\/([0-9a-f-]{36})([^"'\s]*)/gi;

/** Pull `fileName` out of the original URL's query string, if it has one. */
function extractFileName(queryString: string): string | null {
  const match = /[?&]fileName=([^&]*)/i.exec(queryString);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed percent-escape should not lose us the whole rewrite.
    return match[1];
  }
}

/**
 * Build the proxy URL for a single DevOps attachment.
 *
 * @param attachmentId The attachment GUID.
 * @param fileName Original file name, used for Content-Disposition. Optional.
 * @param org DevOps organisation the attachment belongs to. Optional — the proxy
 *   falls back to the `AZURE_DEVOPS_ORG` env var when it is missing.
 */
export function buildAttachmentProxyUrl(
  attachmentId: string,
  fileName?: string | null,
  org?: string | null
): string {
  const params = new URLSearchParams();
  if (fileName) params.set('fileName', fileName);
  if (org) params.set('org', org);
  const query = params.toString();
  return `/api/devops/attachments/${attachmentId}${query ? `?${query}` : ''}`;
}

/**
 * Rewrite every Azure DevOps attachment URL in a fragment of work item HTML so it
 * loads through our authenticated proxy instead of hitting dev.azure.com directly.
 *
 * Safe to call on any HTML: content with no DevOps attachment URLs is returned
 * unchanged, and non-string input yields an empty string.
 */
export function rewriteAttachmentUrls(html: string | null | undefined): string {
  if (!html) return '';

  return html.replace(
    DEVOPS_ATTACHMENT_URL,
    (_full, devAzureOrg: string | undefined, legacyOrg: string | undefined, id, query) => {
      const org = devAzureOrg || legacyOrg || null;
      return buildAttachmentProxyUrl(id, extractFileName(query), org);
    }
  );
}
