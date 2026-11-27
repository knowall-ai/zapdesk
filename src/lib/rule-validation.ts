/**
 * The fields a refused update left empty, read from the DevOps rule error.
 *
 * A board drag asks the process for a transition's required fields first
 * (#662), but that lookup fails open: reading process rules needs a
 * permission an ordinary user may not hold, and then the move is sent with no
 * fields and refused --
 *
 *   TF401320: Rule Error for field Approved By. Error code: Required,
 *   HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty. One additional
 *   error occurred during validation of the work item.
 *
 * That refusal is itself the answer the lookup could not get. Its body carries
 * `customProperties.RuleValidationErrors`, one entry per field with the
 * reference name and status flags, so the fields to ask for can be read
 * straight off it -- including the "one additional error" the message only
 * counts.
 *
 * Only empty fields are returned (`InvalidEmpty`): a field refused for its
 * value, or a transition the process forbids outright, is not something a
 * required-fields dialog can fix, and offering one would only fail again.
 */

interface RuleValidationError {
  fieldReferenceName?: unknown;
  fieldStatusFlags?: unknown;
  ruleValidationErrors?: unknown;
}

/** Never asked for: the state is what is being written, not a missing value. */
const NOT_ASKABLE = new Set(['System.State', 'System.Reason', 'System.WorkItemType']);

/**
 * A work item field reference name: `Namespace.FieldName`, dot-separated.
 *
 * Segments may carry hyphens, underscores and digits, and may start with a
 * digit after the first: DevOps has reported fields such as
 * `AzureCSI-V1.0.Requestor` as empty, and a stricter pattern would leave the
 * user unable to fill one in. No slash, space or other character that could
 * change the meaning of the URL or patch path the name is put in.
 *
 * The one validator for every place a field name crosses a boundary: the
 * rule error read here, the names the state route offers back, and the
 * `additionalFields` it accepts (#663 review).
 */
export const FIELD_REFERENCE = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;

function isEmptyFieldError(error: RuleValidationError): boolean {
  return (
    typeof error.fieldStatusFlags === 'string' &&
    error.fieldStatusFlags.split(',').some((flag) => flag.trim().toLowerCase() === 'invalidempty')
  );
}

/**
 * Reference names of the fields the update needs filled in, in the order
 * DevOps reported them, without duplicates. Empty when the error is anything
 * else, or not a rule error at all.
 */
export function missingFieldsFromRuleError(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const customProperties = (body as { customProperties?: unknown }).customProperties;
  if (!customProperties || typeof customProperties !== 'object') return [];
  const top = (customProperties as { RuleValidationErrors?: unknown }).RuleValidationErrors;

  const found: string[] = [];
  const visit = (errors: unknown, depth: number) => {
    if (!Array.isArray(errors) || depth > 3) return;
    for (const error of errors as RuleValidationError[]) {
      if (!error || typeof error !== 'object') continue;
      const name = error.fieldReferenceName;
      if (
        typeof name === 'string' &&
        FIELD_REFERENCE.test(name) &&
        !NOT_ASKABLE.has(name) &&
        isEmptyFieldError(error) &&
        !found.includes(name)
      ) {
        found.push(name);
      }
      visit(error.ruleValidationErrors, depth + 1);
    }
  };
  visit(top, 0);
  return found;
}

/**
 * Whether DevOps refused the update because the state asked for is not one
 * this work item's type has: `System.State` flagged `InvalidListValue`, as
 * when a Task with no Resolved state is sent Resolved (#725). The message
 * alone ("Rule Error for field State") does not say so in words a user reads.
 */
export function refusesStateValue(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const customProperties = (body as { customProperties?: unknown }).customProperties;
  if (!customProperties || typeof customProperties !== 'object') return false;
  const top = (customProperties as { RuleValidationErrors?: unknown }).RuleValidationErrors;

  const visit = (errors: unknown, depth: number): boolean => {
    if (!Array.isArray(errors) || depth > 3) return false;
    return (errors as RuleValidationError[]).some(
      (error) =>
        !!error &&
        typeof error === 'object' &&
        ((error.fieldReferenceName === 'System.State' &&
          typeof error.fieldStatusFlags === 'string' &&
          error.fieldStatusFlags
            .split(',')
            .some((flag) => flag.trim().toLowerCase() === 'invalidlistvalue')) ||
          visit(error.ruleValidationErrors, depth + 1))
    );
  };
  return visit(top, 0);
}
