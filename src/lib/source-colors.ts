/**
 * Colours that say where a card came from, on the boards that mix Azure DevOps
 * work items with GitHub issues (#447, #454). Requested so the source is
 * identifiable at a glance (#465).
 *
 * Each is drawn as a bar down the left edge of the card -- a position nothing
 * else on a card uses, so it cannot be mistaken for the type badge, the
 * priority dot or the highlight ring.
 *
 * The hues are deliberately not the two products' own brand colours. That was
 * the intuitive choice and measurably the worst: this board already spends
 * purple on Enhancement and blue-cyan on Question, so GitHub purple and Azure
 * blue both landed close to colours a card already wears. `globals.css` has
 * the measurements and `source-colors.test.ts` holds them to it.
 *
 * As with the activity colours, the colour is never the only signal: a GitHub
 * card also carries the GitHub mark and its `owner/repo#n` reference, a DevOps
 * card its work item type and id, and the board shows `SourceLegend` saying
 * which bar means what. A swatch with no meaning beside it explains nothing.
 */

export type SourceKind = 'devops' | 'github';

/** Left-edge bar colour per source. */
export const SOURCE_COLORS: Record<SourceKind, string> = {
  devops: 'var(--source-devops)',
  github: 'var(--source-github)',
};

/** What the legend calls each source. */
export const SOURCE_LABELS: Record<SourceKind, string> = {
  devops: 'Azure DevOps',
  github: 'GitHub',
};

/**
 * Which source a card came from.
 *
 * Anything that is not explicitly a GitHub issue is a DevOps work item: that
 * is the same assumption `isGitHubItem` already makes, kept in one place so
 * the two cannot disagree about a card.
 */
export function sourceKindOf(item: { source?: string }): SourceKind {
  return item.source === 'github' ? 'github' : 'devops';
}

/** The bar itself, as inline style, so a card only has to spread it. */
export function sourceAccentStyle(item: { source?: string }): {
  borderLeft: string;
} {
  return { borderLeft: `3px solid ${SOURCE_COLORS[sourceKindOf(item)]}` };
}
