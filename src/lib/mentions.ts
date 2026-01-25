/**
 * Utility functions for @mention handling
 */

/**
 * Highlights @mentions in HTML content by wrapping them in span elements
 * Matches @username patterns where username can contain letters, numbers, spaces, and dots
 * @param html - The HTML content to process
 * @returns HTML with mentions wrapped in styled spans
 */
export function highlightMentions(html: string): string {
  if (!html) return html;

  // Match @mentions that:
  // - Start with @ preceded by whitespace or start of string
  // - Followed by a name (letters, numbers, spaces, dots, hyphens)
  // - Name continues until we hit certain delimiters or end
  // This regex handles display names like "John Doe" or "Jane.Smith"
  const mentionRegex = /(^|[\s>])(@[\w][\w\s.\-']*[\w]|@[\w])/g;

  return html.replace(mentionRegex, (match, prefix, mention) => {
    // Escape HTML in the mention text for safety
    const escapedMention = escapeHtml(mention);
    return `${prefix}<span class="mention">${escapedMention}</span>`;
  });
}

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

/**
 * Extracts all mentions from a text string
 * @param text - The text to extract mentions from
 * @returns Array of mentioned usernames (without @)
 */
export function extractMentions(text: string): string[] {
  if (!text) return [];

  const mentionRegex = /@([\w][\w\s.\-']*[\w]|[\w])/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1].trim());
  }

  return [...new Set(mentions)]; // Remove duplicates
}
