/**
 * Which fields a state change will require, worked out before it is attempted
 * (#651).
 *
 * A process can make a field required only on certain transitions. The one
 * that prompted this is:
 *
 *   Approval Needed | WHEN System.State whenNot New
 *                   | THEN makeRequired Custom.ApprovedDate ; Custom.ApprovedBy
 *
 * so a Bug or an Enhancement cannot leave New until both are set, in the same
 * revision as the state. ZapDesk sent only `System.State`, the rule rejected
 * it, and the ticket stayed where it was.
 *
 * `required-fields` could not answer this: it reads `required`/`alwaysRequired`
 * off the work item type, which are unconditional. A rule that bites on a
 * transition is not in that list.
 *
 * Pure: the caller fetches the rules and the work item, this decides. Server
 * only in practice, but nothing here touches the network.
 */

/** A condition on a process rule, as the rules endpoint returns it. */
export interface RuleCondition {
  field?: string;
  conditionType?: string;
  value?: string;
}

/** An action on a process rule. */
export interface RuleAction {
  actionType?: string;
  targetField?: string;
  value?: string;
}

export interface ProcessRule {
  name?: string;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
}

/**
 * Actions that give a field a value on this very transition, so the process
 * fills it and nobody should be asked for it.
 *
 * `System.Reason` is the common case: nearly every transition both requires it
 * and copies a value into it, and prompting for a Reason the process is about
 * to overwrite would be noise. Same for ClosedBy, ActivatedDate and the rest
 * of the stamped fields.
 */
const SERVER_FILLS = new Set([
  'copyValue',
  'copyFromCurrentUser',
  'copyFromServerClock',
  'copyFromField',
  'setDefaultValue',
  'setDefaultFromCurrentUser',
  'setValueToEmpty',
]);

/**
 * Does this condition hold for `from` -> `to`?
 *
 * Only conditions on `System.State` can be judged here. A rule keyed on
 * another field -- `System.Reason when Duplicate`, say -- depends on what the
 * update will contain, which is not known yet, so {@link appliesToTransition}
 * treats such a rule as not applicable rather than guessing. The cost of
 * guessing wrong is prompting for a field nobody needs, or missing one; the
 * cost of abstaining is that the update is attempted and the server's own
 * error is shown, which is the existing behaviour and is honest.
 */
export function conditionHolds(condition: RuleCondition, from: string, to: string): boolean {
  if (condition.field !== 'System.State') return false;
  const value = condition.value ?? '';
  switch (condition.conditionType) {
    case 'when':
      return to === value;
    case 'whenNot':
      return to !== value;
    case 'whenWas':
      // An empty `whenWas` means "on creation"; this is always an existing
      // item, so it cannot match.
      return value === '' ? false : from === value;
    case 'whenChanged':
      return from !== to;
    case 'whenNotChanged':
      return from === to;
    default:
      return false;
  }
}

/** Whether every condition of `rule` holds for this transition. */
export function appliesToTransition(rule: ProcessRule, from: string, to: string): boolean {
  const conditions = rule.conditions ?? [];
  // No conditions means it always applies.
  if (conditions.length === 0) return true;
  // A condition this cannot judge disqualifies the whole rule: all of them
  // have to hold, so one unknown makes the answer unknown.
  if (conditions.some((c) => c.field !== 'System.State')) return false;
  return conditions.every((c) => conditionHolds(c, from, to));
}

/**
 * Fields the ticket UI already owns, or that every existing item carries.
 *
 * A process makes several of these required unconditionally -- Title, Area,
 * Iteration -- which is true but useless here: the item could not exist
 * without them. `System.Reason` is required by almost every transition and
 * copied into by the same rule, so it is covered by {@link SERVER_FILLS} too;
 * it is named here as well because a process that required it *without* a
 * copy would otherwise prompt for a field the dialog has no business asking
 * about. Mirrors the exclusions the type-change endpoint already applies.
 */
const HANDLED_BY_UI = new Set([
  'System.Title',
  'System.Description',
  'System.State',
  'System.Reason',
  'System.WorkItemType',
  'System.AssignedTo',
  'System.Tags',
  'System.AreaId',
  'System.AreaPath',
  'System.IterationId',
  'System.IterationPath',
  'System.CreatedBy',
  'System.ChangedBy',
]);

/**
 * Field reference names this transition will require a value for.
 *
 * @param rules The work item type's process rules.
 * @param from The state the item is in now.
 * @param to The state it is moving to.
 * @param hasValue Whether the item already holds a value for a field. A field
 *   that is required and already set -- `System.Title` on any existing item --
 *   needs no prompt.
 */
export function requiredFieldsForTransition(
  rules: readonly ProcessRule[],
  from: string,
  to: string,
  hasValue: (referenceName: string) => boolean
): string[] {
  const required = new Set<string>();
  const filled = new Set<string>();

  for (const rule of rules) {
    if (!appliesToTransition(rule, from, to)) continue;
    for (const action of rule.actions ?? []) {
      const target = action.targetField;
      if (!target) continue;
      if (action.actionType === 'makeRequired') required.add(target);
      else if (action.actionType && SERVER_FILLS.has(action.actionType)) filled.add(target);
    }
  }

  return [...required]
    .filter((field) => !HANDLED_BY_UI.has(field) && !filled.has(field) && !hasValue(field))
    .sort();
}

/** Whether a work item field holds something. */
export function fieldHasValue(fields: Record<string, unknown> | undefined, name: string): boolean {
  const value = fields?.[name];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}
