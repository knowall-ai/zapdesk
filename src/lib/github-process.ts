import type { TicketStatus } from '@/types';
import type { WorkItemStateDef } from './state-categories';

/**
 * The GitHub process template (#567).
 *
 * ZapDesk reads statuses out of Azure DevOps **process templates**: Agile,
 * Scrum, Basic, CMMI, KnowAll. Each defines its own states, and each state
 * belongs to a category, which is what `state-categories.ts` resolves against.
 *
 * GitHub has no process. An issue is `open` or `closed`, with a
 * `state_reason`, plus whatever labels the repository happens to use. So a
 * GitHub issue could only ever be shown in the first or the last column, never
 * In Progress, Pending or Resolved -- and a status could not be written back
 * to it at all.
 *
 * This module is the missing definition: the states a GitHub issue can be in,
 * their categories, and the mapping to and from ZapDesk's six statuses in both
 * directions. The states are named after the statuses, because unlike a
 * development process this one exists to describe a support desk.
 */

/** The template's name, as the projects and admin pages show it. */
export const GITHUB_PROCESS_NAME = 'GitHub';

/**
 * The labels that carry the statuses GitHub's own state cannot express.
 *
 * `open` covers New, Open, In Progress and Pending; `closed` covers Resolved
 * and Closed. The difference within each is held in a label. `blocked` is
 * accepted beside `status: pending` because it is what repositories already
 * use for the same thing.
 */
export const GITHUB_STATUS_LABELS: Readonly<Record<string, TicketStatus>> = {
  'status: open': 'Open',
  'status: in progress': 'In Progress',
  'status: in-progress': 'In Progress',
  'status: pending': 'Pending',
  blocked: 'Pending',
  'status: resolved': 'Resolved',
};

/**
 * The label written for a status, or undefined when the GitHub state says it
 * on its own.
 *
 * New needs no label: it is an open issue nobody has picked up. Closed needs
 * none either, because `state: closed` with no `status: resolved` is it.
 */
export const GITHUB_LABEL_FOR_STATUS: Readonly<Partial<Record<TicketStatus, string>>> = {
  Open: 'status: open',
  'In Progress': 'status: in progress',
  Pending: 'status: pending',
  Resolved: 'status: resolved',
};

/** Every label this template manages, so a write can clear the others. */
export const GITHUB_MANAGED_LABELS: readonly string[] = Object.keys(GITHUB_STATUS_LABELS);

/**
 * The template's states and their categories, in workflow order.
 *
 * Shaped like a DevOps work item type's state list so the shared machinery --
 * Kanban columns, SLA, the status filters -- can treat a GitHub board the same
 * way it treats any other.
 */
export const GITHUB_STATES: readonly WorkItemStateDef[] = [
  { name: 'New', category: 'Proposed' },
  { name: 'Open', category: 'InProgress' },
  { name: 'In Progress', category: 'InProgress' },
  { name: 'Pending', category: 'InProgress' },
  { name: 'Resolved', category: 'Resolved' },
  { name: 'Closed', category: 'Completed' },
];

const CATEGORY_OF = new Map(GITHUB_STATES.map((state) => [state.name, state.category]));

/** The category of one of this template's states, or Proposed for anything else. */
export function gitHubStateCategory(state: string): string {
  return CATEGORY_OF.get(state) ?? 'Proposed';
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** The status a label names, if it names one. */
function statusFromLabel(label: string): TicketStatus | undefined {
  return GITHUB_STATUS_LABELS[normalize(label)];
}

/**
 * The order statuses are preferred in when an issue carries more than one
 * status label.
 *
 * Labels accumulate -- somebody adds `status: in progress` and forgets to take
 * off `status: open`. The furthest along wins, since that is the one somebody
 * set most recently in every ordinary sequence of events.
 */
const OPEN_PRECEDENCE: readonly TicketStatus[] = ['Pending', 'In Progress', 'Open'];

export interface GitHubIssueState {
  state: string;
  stateReason?: string | null;
  labels?: readonly string[] | null;
  hasAssignee?: boolean;
}

/**
 * GitHub -> ZapDesk. The status an issue is in.
 *
 * A closed issue is Resolved only when it is labelled so; otherwise it is
 * Closed, whether it was completed or dropped as not planned. An open issue
 * takes its status from its labels, then from whether anyone is assigned: an
 * assigned issue is Open, an unassigned one is New, which is what "raised,
 * not yet triaged" means on a support desk.
 */
export function gitHubStatusFor(issue: GitHubIssueState): TicketStatus {
  const labels = (issue.labels ?? []).map(statusFromLabel).filter(Boolean) as TicketStatus[];

  if (issue.state.toLowerCase() === 'closed') {
    return labels.includes('Resolved') ? 'Resolved' : 'Closed';
  }

  for (const status of OPEN_PRECEDENCE) {
    if (labels.includes(status)) return status;
  }

  return issue.hasAssignee ? 'Open' : 'New';
}

/** The change to make on GitHub to put an issue into `status`. */
export interface GitHubStatusWrite {
  /** `open` reopens a closed issue; every status but Resolved and Closed is open. */
  state: 'open' | 'closed';
  /** Only set when closing, since GitHub rejects it on an open issue. */
  stateReason?: 'completed' | 'not_planned';
  /** The status label to put on, if this status has one. */
  addLabel?: string;
  /** The template's other labels, which must come off so two cannot disagree. */
  removeLabels: string[];
}

/**
 * ZapDesk -> GitHub. What to write for a status.
 *
 * Anything that is not Resolved or Closed is an open issue, so setting one of
 * those on a closed issue reopens it -- which is what moving a card out of the
 * last column means.
 */
export function gitHubWriteForStatus(status: TicketStatus): GitHubStatusWrite {
  const closed = status === 'Resolved' || status === 'Closed';
  const addLabel = GITHUB_LABEL_FOR_STATUS[status];

  return {
    state: closed ? 'closed' : 'open',
    ...(closed ? { stateReason: 'completed' as const } : {}),
    ...(addLabel ? { addLabel } : {}),
    removeLabels: GITHUB_MANAGED_LABELS.filter(
      (label) => !addLabel || normalize(label) !== normalize(addLabel)
    ),
  };
}

/**
 * The labels an issue should end up with after a status change.
 *
 * Returned whole rather than as a patch: GitHub's label endpoint replaces the
 * set, and computing it here keeps the labels a repository uses for its own
 * purposes -- `bug`, `ticket`, a component name -- untouched.
 */
export function gitHubLabelsAfterStatus(
  current: readonly string[],
  status: TicketStatus
): string[] {
  const { addLabel, removeLabels } = gitHubWriteForStatus(status);
  const removed = new Set(removeLabels.map(normalize));
  const kept = current.filter((label) => !removed.has(normalize(label)));

  if (!addLabel) return kept;
  if (kept.some((label) => normalize(label) === normalize(addLabel))) return kept;
  return [...kept, addLabel];
}
