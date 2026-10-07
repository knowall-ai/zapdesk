/** A state as the process definition reports it. */
export interface ProcessState {
  name: string;
  stateCategory?: string;
  hidden?: boolean;
}

/** A state as the per-project endpoint reports it, which is what callers expect. */
export interface EffectiveState {
  name: string;
  category: string;
}

/**
 * The states a work item type actually offers, from its process definition.
 *
 * Reading states per process rather than per project and type turns the board's
 * metadata warm-up from 647 requests into 4 on this organisation (#7387). The
 * two views agree only under the rule below.
 *
 * A customised type lists an inherited state twice: once as it came from the
 * base process, and again as an `inherited` entry carrying `hidden: true` when
 * the customiser turned it off. Keeping the first occurrence therefore keeps
 * states the project does not offer -- `Active` and `Resolved` came back on
 * types where they had been hidden. So a name is dropped if *any* entry for it
 * is hidden, which is what makes this match the per-project answer exactly.
 */
export function effectiveStates(states: ProcessState[] | undefined): EffectiveState[] {
  const all = states ?? [];
  const hidden = new Set(all.filter((s) => s.hidden).map((s) => s.name));

  const out: EffectiveState[] = [];
  const seen = new Set<string>();
  for (const state of all) {
    if (hidden.has(state.name) || seen.has(state.name)) continue;
    seen.add(state.name);
    out.push({ name: state.name, category: state.stateCategory ?? '' });
  }
  return out;
}

/**
 * Work item types the process view does not describe, and we do not need.
 *
 * These are the system types Azure DevOps attaches to every project. They are
 * never shown on a board, and the work item types endpoint already filters the
 * same list, so their absence from the process view costs nothing. Named here
 * so the gap is recorded rather than discovered later.
 */
export const TYPES_ABSENT_FROM_PROCESS_VIEW = [
  'Code Review Request',
  'Code Review Response',
  'Feedback Request',
  'Feedback Response',
  'Shared Parameter',
  'Shared Steps',
] as const;
