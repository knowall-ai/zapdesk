/**
 * GitHub issues on the Kanban boards (#447).
 *
 * The boards' columns are Azure DevOps states, and a GitHub issue is only open
 * or closed. An issue is shown as a read-only card: open ones in the first
 * column, closed ones in the last. It cannot be dragged, because a drop writes
 * a state to DevOps.
 */

import type { ProjectStandupData, StandupColumn, StandupWorkItem, Ticket } from '@/types';

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
 * Closed issues go to the "Closed" column, or failing that the last Completed
 * one; open issues go to the first Proposed column. A board with neither falls
 * back to its last and first column.
 */
export function gitHubColumnFor(issueState: string, columns: BoardColumn[]): string | null {
  if (columns.length === 0) return null;

  if (issueState.toLowerCase() === 'closed') {
    const closed =
      columns.find((c) => c.name.toLowerCase() === 'closed') ??
      columns.filter((c) => c.category === 'Completed').pop() ??
      columns[columns.length - 1];
    return closed.name;
  }

  return (columns.find((c) => c.category === 'Proposed') ?? columns[0]).name;
}

/** A GitHub issue, already mapped to a ticket, as a card for the Kanban Board page. */
export function gitHubTicketToStandupItem(ticket: Ticket): StandupWorkItem {
  const closed = ticket.devOpsState.toLowerCase() === 'closed';
  return {
    id: ticket.id,
    title: ticket.title,
    state: ticket.devOpsState,
    stateCategory: closed ? 'Completed' : 'Proposed',
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
