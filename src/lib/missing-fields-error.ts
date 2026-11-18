import type { RequiredField } from '@/hooks/useWorkItemActions';

/**
 * DevOps refused a state change because fields it requires were empty, and
 * said which (#663).
 *
 * The board asks the process for a transition's required fields before it
 * writes, but that lookup fails open -- process rules need a permission an
 * ordinary user may not hold -- so the move can still go out without them.
 * The refusal names the fields, and the state route hands them back
 * described. Thrown with them, the board can open the required-fields dialog
 * instead of showing "TF401320: Rule Error for field Approved By".
 */
export class MissingFieldsError extends Error {
  /** Marked by property as well as class, as `StateChangeCancelled` is. */
  readonly missingFieldsError = true;

  constructor(
    message: string,
    readonly fields: RequiredField[]
  ) {
    super(message);
    this.name = 'MissingFieldsError';
  }
}

/** The fields `error` says are missing, or `null` when it is any other error. */
export function missingFieldsOf(error: unknown): RequiredField[] | null {
  if (typeof error !== 'object' || error === null) return null;
  if ((error as { missingFieldsError?: unknown }).missingFieldsError !== true) return null;
  const fields = (error as { fields?: unknown }).fields;
  return Array.isArray(fields) && fields.length > 0 ? (fields as RequiredField[]) : null;
}

/**
 * The described fields in a state route's error body, or `null` when it names
 * none. Tolerant of anything: it reads a server response.
 */
export function missingFieldsInBody(body: unknown): RequiredField[] | null {
  if (!body || typeof body !== 'object') return null;
  const fields = (body as { missingFields?: unknown }).missingFields;
  if (!Array.isArray(fields)) return null;
  const valid = fields.filter(
    (field): field is RequiredField =>
      !!field &&
      typeof field === 'object' &&
      typeof (field as RequiredField).referenceName === 'string' &&
      typeof (field as RequiredField).name === 'string'
  );
  return valid.length > 0 ? valid : null;
}
