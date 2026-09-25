import type { Permission } from '@/types';

/**
 * The two ways a caller can ask `PermissionGate` a question.
 *
 * Exactly one must be supplied. Both together, or neither, is a coding
 * mistake rather than a policy: see `decidePermissionGate`.
 */
export interface PermissionGateModes {
  permission?: Permission;
  anyPermission?: Permission[];
}

export type GateDecision = 'allow' | 'deny' | 'misconfigured';

/**
 * Decide whether a permission gate should render its children.
 *
 * Split out of the component so the decision can be tested in the existing
 * node test environment, without pulling a DOM renderer into the project.
 *
 * The rules that matter:
 *
 * - No mode at all is `misconfigured`, not `allow`. A gate written as
 *   `<PermissionGate>{secret}</PermissionGate>` -- a prop typo, a refactor
 *   that dropped the `permission=` -- used to render its children to
 *   everyone, which is the one outcome a gate must never produce by accident.
 * - Both modes at once is also `misconfigured`. The old code silently ANDed
 *   them; a reader would just as reasonably expect OR, so the ambiguity is
 *   rejected instead of guessed at.
 * - An empty `anyPermission` list denies. "Any of nothing" is satisfied by
 *   nothing, and reading it as "no requirement" would open the gate.
 * - An `anyPermission` that is present but not an array is `misconfigured`.
 *   Types do not reach a JS caller or an `as any` cast, and a gate that
 *   throws mid-render takes the surrounding page down with it.
 *
 * Callers render the fallback for both `deny` and `misconfigured`, so a
 * mistake fails closed.
 */
export function decidePermissionGate(
  { permission, anyPermission }: PermissionGateModes,
  has: (permission: Permission) => boolean,
  hasAny: (permissions: Permission[]) => boolean
): GateDecision {
  const modes = (permission !== undefined ? 1 : 0) + (anyPermission !== undefined ? 1 : 0);
  if (modes !== 1) return 'misconfigured';

  if (permission !== undefined) {
    return has(permission) ? 'allow' : 'deny';
  }

  if (!Array.isArray(anyPermission)) return 'misconfigured';
  if (anyPermission.length === 0) return 'deny';

  return hasAny(anyPermission) ? 'allow' : 'deny';
}
