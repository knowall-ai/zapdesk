/**
 * Kanban column / DevOps state reconciliation.
 *
 * The stand-up board renders a fixed set of display columns (New, To Do,
 * Active, Blocked, Resolved, Closed) that is really a *union* across every
 * process template in the org. Any individual work item can only ever enter
 * the states its own work item type defines — an Agile-template Bug has no
 * "To Do" state at all — so a column that is valid for one card is invalid
 * for another. Dropping onto an invalid column makes DevOps reject the PATCH
 * with a workflow rule error (TF401320) and the card silently snaps back
 * (issues #391, #366).
 *
 * These helpers let the board ask "can *this* card go in *that* column?"
 * before offering the drop target.
 */

/**
 * Normalize a state or column name for tolerant comparison.
 *
 * Templates serialize the same logical state in different shapes — "To Do",
 * "ToDo", "To-Do", occasionally with a non-breaking space — so comparisons
 * strip case and everything that isn't alphanumeric.
 */
export function normalizeStateName(name: string): string {
  // Letters and digits of any script are kept: stripping everything outside
  // a-z0-9 turned every non-Latin name (未着手, 進行中) into "" and so made
  // them all match one another (#687 review).
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Project -> work item type -> the state names that type defines there. */
export type AllowedStates = Record<string, Record<string, string[]>>;

/**
 * The states `workItemType` defines *in the project the card actually lives
 * in*. Scoping by project matters: process templates are per project, so a
 * Bug in one project can define "To Do" while a Bug in another doesn't.
 * Reading a union across projects would offer a drop target the card's own
 * project rejects.
 *
 * Returns undefined when we know nothing, which callers treat as "allow".
 */
function statesFor(
  project: string | undefined,
  workItemType: string | undefined,
  allowedStates: AllowedStates | undefined
): string[] | undefined {
  if (!project || !workItemType) return undefined;
  const states = allowedStates?.[project]?.[workItemType];
  return states && states.length > 0 ? states : undefined;
}

/**
 * Whether `workItemType` defines a state matching `columnName` in `project`.
 *
 * Fails open: when we have no state list for that project and type (state
 * discovery failed, or the type is new), the drop is allowed and the server
 * remains the authority. Blocking on absent data would break working drags.
 */
export function canTypeEnterColumn(
  project: string | undefined,
  workItemType: string | undefined,
  columnName: string,
  allowedStates: AllowedStates | undefined
): boolean {
  const states = statesFor(project, workItemType, allowedStates);
  if (!states) return true;
  const target = normalizeStateName(columnName);
  return states.some((state) => normalizeStateName(state) === target);
}

/**
 * Translate a display column name into the state name DevOps actually expects
 * for this work item type in this project.
 *
 * The column label and the state name are NOT interchangeable. The board shows
 * "To Do" while the KnowAll process defines the state as "Todo", and PATCHing
 * the label verbatim is rejected — which is why no card could be dragged into
 * that column regardless of its type (#391).
 *
 * Falls back to the column name when the type's states are unknown, leaving
 * the server to have the final say.
 */
export function resolveStateForColumn(
  project: string | undefined,
  workItemType: string | undefined,
  columnName: string,
  allowedStates: AllowedStates | undefined
): string {
  const states = statesFor(project, workItemType, allowedStates);
  if (!states) return columnName;
  const target = normalizeStateName(columnName);
  return states.find((state) => normalizeStateName(state) === target) ?? columnName;
}
