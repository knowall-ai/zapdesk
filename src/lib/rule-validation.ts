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

/** A plausible field reference name, so nothing odd reaches a URL. */
const REFERENCE_NAME = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;

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
        REFERENCE_NAME.test(name) &&
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
