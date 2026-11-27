/**
 * The message for an `owner/*` mapping whose organization has more issues than
 * one read takes (#621).
 *
 * An organization is read as one newest-first list with a page cap shared by
 * every repository in it. Past the cap, the quieter repositories drop off the
 * end with no error, so without this the Tickets tab and the boards would show
 * a repository with missing issues the same way as one that has none.
 * Repositories named in the mapping are read on their own, so naming the ones
 * that matter is the way to see them in full.
 *
 * Kept apart from `github-issues` so the client pages can use it without
 * pulling in the server-side reader.
 */
export function gitHubTruncationMessage(truncatedRepos: readonly string[]): string | null {
  if (truncatedRepos.length === 0) return null;
  // A named repository past its own caps (#705) can't be split any further,
  // so only an organization gets the advice to name repositories.
  const advice = truncatedRepos.some((repo) => repo.endsWith('/*'))
    ? 'Map the repositories you need by name to see all of their issues.'
    : '';
  return (
    `Some GitHub issues from ${truncatedRepos.join(', ')} may be missing: ` +
    'there are more issues than ZapDesk reads at once.' +
    (advice ? ` ${advice}` : '')
  );
}
