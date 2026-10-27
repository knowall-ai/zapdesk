/**
 * What makes a ticket title acceptable (7772).
 *
 * Shared by the ticket screen and `PATCH /api/devops/tickets/[id]` so the
 * control and the server cannot disagree about it: a rule only the server
 * knows shows up as a failed save, and a rule only the screen knows is no
 * rule at all.
 */

/** DevOps refuses a `System.Title` longer than this. */
export const MAX_TITLE_LENGTH = 255;

/**
 * Why this title cannot be saved, in words for the person typing it, or null
 * when it can be.
 *
 * Trimmed first: a title of spaces is empty as far as DevOps is concerned, and
 * trailing spaces are not what anyone means to save.
 */
export function titleProblem(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed === '') return 'A title is required.';
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return `A title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
  }
  return null;
}
