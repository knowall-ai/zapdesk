/**
 * The work item type badge colours (#575).
 *
 * The badge used to draw its text in the raw Azure DevOps type colour over a
 * 12.5% tint of the same colour. Those hues are designed for DevOps' light
 * theme, so as text on ZapDesk's dark card they were unreadable: `Enhancement`
 * measured 2.10:1 against the WCAG AA minimum of 4.5:1 for small text, and the
 * badge text is 10px. Four of the six failed, not just the one reported --
 * `Bug` 2.92:1, `Issue` 2.64:1 and `Question` 4.49:1, a hair short.
 *
 * So the hue and the text colour are now two different things:
 *
 * - {@link WORK_ITEM_TYPE_HUES} keeps the DevOps hue, and is used only for the
 *   badge's background tint, so a type still wears the colour people know it
 *   by in DevOps and on the board legend.
 * - {@link WORK_ITEM_TYPE_TEXT} is a lighter tint of that same hue, chosen to
 *   clear 4.5:1 against the tinted badge over both `--surface` and
 *   `--surface-hover`. Same hue family, so nothing is recoloured, just lifted.
 *
 * `work-item-type-colors.test.ts` composites the tint over the card and
 * measures every pair, so a later edit that drops one below AA fails there
 * rather than shipping. ZapDesk has no light theme, so there is one set.
 *
 * The colours live here rather than in a card component because a colour
 * table is not a card's business and `source-colors.test.ts` already has to
 * import it to check the source accents against what a card wears.
 *
 * The stand-up card is the only place that draws a type's hue as text. The
 * work item table and the dialog header draw the type in `--text-secondary`
 * on a neutral surface with the hue as a left border, which was readable
 * already and is deliberately left alone.
 */

/** The DevOps hue per type. Background tint only -- never used as text. */
export const WORK_ITEM_TYPE_HUES: Record<string, string> = {
  Bug: '#cc293d',
  Task: '#f2cb1d',
  Enhancement: '#773b93',
  Question: '#009ccc',
  Issue: '#b4009e',
  Risk: '#ff7b00',
};

/**
 * Badge text per type: the same hue, lifted until it clears AA on a dark card.
 *
 * `Task` is unchanged -- DevOps' yellow was already readable at 8.07:1, and
 * moving a colour that passes would be churn.
 */
export const WORK_ITEM_TYPE_TEXT: Record<string, string> = {
  Bug: '#f87171',
  Task: '#f2cb1d',
  Enhancement: '#c084fc',
  Question: '#22d3ee',
  Issue: '#f472b6',
  Risk: '#fb923c',
};

/**
 * A type ZapDesk has no colour for -- a custom work item type on an inherited
 * process, which any project can add.
 *
 * It needs a hex rather than `var(--text-muted)`, which is what the card used
 * to fall back to: the badge builds its background by appending an alpha
 * suffix to the colour, and `var(--text-muted)20` is not a colour, so an
 * unknown type lost its background tint entirely and was drawn in the dimmest
 * text on the card. These are `--text-secondary` and `--text-muted`'s hexes.
 */
export const UNKNOWN_TYPE_TEXT = '#9ca3af';
export const UNKNOWN_TYPE_HUE = '#6b7280';

/**
 * How much of the hue the badge background carries: `20` of 255, 12.5%.
 *
 * Kept here because the contrast figures above are only true at this alpha --
 * a heavier tint moves the background the text is measured against.
 */
export const TYPE_BADGE_TINT = '20';

/** The badge's colours for a type, ready to spread into `style`. */
export function workItemTypeBadgeStyle(workItemType: string | undefined): {
  backgroundColor: string;
  color: string;
} {
  const hue = (workItemType && WORK_ITEM_TYPE_HUES[workItemType]) || UNKNOWN_TYPE_HUE;
  const text = (workItemType && WORK_ITEM_TYPE_TEXT[workItemType]) || UNKNOWN_TYPE_TEXT;
  return { backgroundColor: `${hue}${TYPE_BADGE_TINT}`, color: text };
}
