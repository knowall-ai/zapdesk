/** Shared request-body validation helpers for DevOps mutation routes. */

/** Azure DevOps work item ids are positive int32 values. */
export const MAX_WORK_ITEM_ID = 2_147_483_647;

/** Azure DevOps caps project names at 64 characters. */
export const MAX_PROJECT_LENGTH = 64;

/** Maximum length for state/status strings sent to DevOps. */
export const MAX_STATE_LENGTH = 128;

/** Maximum length for comment text. */
export const MAX_COMMENT_LENGTH = 100_000;

type ValidationError = { ok: false; status: number; error: string };
type OkResult<T> = { ok: true; data: T };
export type ValidationResult<T> = OkResult<T> | ValidationError;

/**
 * Validate that the request body is a plain JSON object (not null, not an array).
 * Returns the parsed body or a 400 error.
 */
export function validateJsonObject(rawBody: unknown): ValidationResult<Record<string, unknown>> {
  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object' };
  }
  return { ok: true, data: rawBody as Record<string, unknown> };
}

/**
 * Reject any keys not in the allowed set. Returns a 400 error listing unknown fields.
 */
export function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowedKeys: string[]
): ValidationResult<void> {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Unexpected field(s) in request body: ${unknown.join(', ')}`,
    };
  }
  return { ok: true, data: undefined };
}

/**
 * Validate a required string field (non-empty, trimmed, max length).
 */
export function validateRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number
): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, status: 400, error: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, status: 400, error: `${fieldName} must not be empty` };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      status: 400,
      error: `${fieldName} must be at most ${maxLength} characters`,
    };
  }
  return { ok: true, data: trimmed };
}

/**
 * Validate an optional string field (omitted when undefined; if provided, must be a non-empty string after trim, max length).
 */
export function validateOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number
): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, data: undefined };
  }
  if (typeof value !== 'string') {
    return { ok: false, status: 400, error: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, status: 400, error: `${fieldName} must not be empty` };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      status: 400,
      error: `${fieldName} must be at most ${maxLength} characters`,
    };
  }
  return { ok: true, data: trimmed };
}

/**
 * Validate an optional boolean field (omitted when undefined; if provided, must be a boolean).
 */
export function validateOptionalBoolean(
  value: unknown,
  fieldName: string
): ValidationResult<boolean | undefined> {
  if (value === undefined) {
    return { ok: true, data: undefined };
  }
  if (typeof value !== 'boolean') {
    return { ok: false, status: 400, error: `${fieldName} must be a boolean` };
  }
  return { ok: true, data: value };
}
