/**
 * Centralized priority constants.
 *
 * These serve as fallback labels when the Azure DevOps API returns only
 * numeric values for the built-in Microsoft.VSTS.Common.Priority field.
 * Where possible, priority labels should be fetched dynamically from
 * DevOps via the /api/devops/projects/[project]/priorities endpoint.
 */

/** Fallback labels for numeric priority values (1-4) returned by DevOps */
export const DEFAULT_PRIORITY_LABELS: Record<string, string> = {
  '1': 'Critical',
  '2': 'High',
  '3': 'Medium',
  '4': 'Low',
};

/** Reverse map: label (lowercase) or numeric string → numeric value */
export const PRIORITY_LABEL_TO_NUMBER: Record<string, number> = {
  critical: 1,
  '1': 1,
  high: 2,
  '2': 2,
  medium: 3,
  '3': 3,
  low: 4,
  '4': 4,
};

/** Sort order for priority labels (lower = higher priority) */
export const PRIORITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

/** Default priority options for dropdowns (value → label) */
export const DEFAULT_PRIORITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Critical' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'Low' },
];
