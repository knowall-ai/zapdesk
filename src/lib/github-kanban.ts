/**
 * GitHub issues on the Kanban boards (#447).
 *
 * The boards' columns are Azure DevOps states. A GitHub issue's state comes
 * from the GitHub process template (#567), which gives it one of ZapDesk's six
 * statuses rather than only open or closed -- so an issue can sit in the In
 * Progress or Pending column like any other card.
 */

import type { ProjectStandupData, StandupColumn, StandupWorkItem, Ticket } from '@/types';
import { gitHubStateCategory } from './github-process';
import { normalizeStateName } from './kanban-columns';

interface BoardColumn {
  name: string;
  category: string;
}

/** True for a card or row that came from GitHub. */
export function isGitHubItem(item: { source?: string }): boolean {
  return item.source === 'github';
}

/**
 * The board column a GitHub issue belongs in, or null for a board with no
 * columns.
 *
 * A column whose name is the issue's state wins: a board with a Pending column
 * should show a pending issue there, whatever category the DevOps process put
 * that column in. Otherwise the state's category decides, and a state whose
 * category has no column falls back the way it always did -- completed states
 * to the last column, everything else to the first.
 */
export function gitHubColumnFor(issueState: string, columns: BoardColumn[]): string | null {
  if (columns.length === 0) return null;

  const state = normalizeStateName(issueState);
  const named = columns.find((c) => normalizeStateName(c.name) === state);
  if (named) return named.name;

  const category = gitHubStateCategory(issueState);

  // A board often ends in several Completed columns -- Done, then Shipped --
  // and the last one is where finished work comes to rest.
  const lastCompleted = () => columns.filter((c) => c.category === 'Completed').pop();

  if (category === 'Completed') {
    return (lastCompleted() ?? columns[columns.length - 1]).name;
  }

  if (category === 'Resolved') {
    return (
      columns.find((c) => c.category === 'Resolved') ??
      lastCompleted() ??
      columns[columns.length - 1]
    ).name;
  }

  return (
    columns.find((c) => c.category === category) ??
    columns.find((c) => c.category === 'Proposed') ??
    columns[0]
  ).name;
}

/** A GitHub issue, already mapped to a ticket, as a card for the Kanban Board page. */
export function gitHubTicketToStandupItem(ticket: Ticket): StandupWorkItem {
  return {
    id: ticket.id,
    title: ticket.title,
    state: ticket.devOpsState,
    stateCategory: gitHubStateCategory(ticket.devOpsState),
    workItemType: ticket.workItemType,
    assignee: ticket.assignee,
    priority: ticket.priority,
    updatedAt: new Date(ticket.updatedAt).toISOString(),
    createdAt: new Date(ticket.createdAt).toISOString(),
    project: ticket.project,
    devOpsUrl: ticket.devOpsUrl,
    tags: ticket.tags,
    source: 'github',
    sourceUrl: ticket.sourceUrl,
    sourceRef: ticket.sourceRef,
  };
}

/**
 * The GitHub issues the Kanban board should show.
 *
 * The DevOps side leaves unowned work out in the WIQL (#581, #530); GitHub
 * issues are already in memory by this point, so there is nothing to save by
 * filtering earlier -- what matters is that the two sources agree, or the board
 * would show unowned issues beside owned work items and look arbitrary.
 *
 * Unowned means no GitHub assignee at all. An issue assigned to a login that
 * maps to no DevOps person still has an `assignee`: `gitHubUserToPerson` falls
 * back to the GitHub identity, and `regroupByPerson` heads a column with that
 * login. Such a card is kept -- hiding one the board labels with a person's
 * name would drop owned work, which #581 asks to preserve.
 */
export function boardGitHubTickets(
  tickets: Ticket[],
  includeUnassigned: boolean,
  /**
   * First day inside the board's closed window as `YYYY-MM-DD`, or null for
   * "All" (#6713). Closed issues outside it are dropped here rather than at
   * the fetch, because GitHub's `since` filters on the last update and the
   * window is about when the issue was closed -- the same split as the DevOps
   * side, where WIQL bounds ChangedDate and `isOutsideClosedWindow` applies
   * the closed date per item.
   */
  closedFloor: string | null = null,
  /**
   * The day after the board's, as `YYYY-MM-DD`: the window's exclusive upper
   * bound. It applies to "All" as well, where there is no floor, because a
   * board asked for an earlier date must not show work closed after it.
   *
   * Applied here and not at the fetch because the GitHub API has no `until`:
   * `since` returns issues *updated* after the floor, so one closed after the
   * board's day is fetched regardless.
   *
   * Omitted, nothing is bounded above. The board always passes it, today's
   * included -- the standup route builds it from the board's own date -- so
   * the default describes a caller that has no window in mind, not any
   * board.
   */
  closedEnd: string | null = null
): Ticket[] {
  const owned = includeUnassigned ? tickets : tickets.filter((ticket) => ticket.assignee);
  if (!closedFloor && !closedEnd) return owned;

  const floor = closedFloor === null ? null : new Date(closedFloor).getTime();
  const end = closedEnd === null ? null : new Date(closedEnd).getTime();

  return owned.filter((ticket) => {
    // Only closed issues are windowed. An open one has no closed date, and a
    // GitHub issue that is Resolved rather than Closed (#567) waits on a
    // person, so age is a reason to show it, not to hide it (#518).
    if (ticket.status !== 'Closed') return true;
    // No closed date to judge by: keep it, as the DevOps filter keeps an item
    // it cannot judge.
    if (!ticket.resolvedAt) return true;
    const closedAt = new Date(ticket.resolvedAt).getTime();
    if (floor !== null && closedAt < floor) return false;
    return end === null || closedAt < end;
  });
}

/**
 * Add GitHub issues to the Kanban Board page's projects.
 *
 * Each issue joins the board of the DevOps project its repository is mapped
 * to, after that column's DevOps cards. A project with issues but no DevOps
 * items gets a board of its own. Projects stay in alphabetical order.
 */
export function addGitHubTicketsToStandup(
  projects: ProjectStandupData[],
  displayColumns: BoardColumn[],
  tickets: Ticket[]
): ProjectStandupData[] {
  if (tickets.length === 0) return projects;

  const byProject = new Map<string, Map<string, StandupWorkItem[]>>();
  for (const project of projects) {
    byProject.set(
      project.projectName,
      new Map(project.columns.map((column) => [column.name, [...column.items]]))
    );
  }

  for (const ticket of tickets) {
    const columnName = gitHubColumnFor(ticket.devOpsState, displayColumns);
    if (!columnName) continue;
    let columns = byProject.get(ticket.project);
    if (!columns) {
      columns = new Map();
      byProject.set(ticket.project, columns);
    }
    const items = columns.get(columnName) ?? [];
    items.push(gitHubTicketToStandupItem(ticket));
    columns.set(columnName, items);
  }

  return Array.from(byProject.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([projectName, columns]) => ({
      projectName,
      columns: displayColumns.map(
        (column): StandupColumn => ({
          name: column.name,
          category: column.category,
          items: columns.get(column.name) ?? [],
        })
      ),
    }));
}
