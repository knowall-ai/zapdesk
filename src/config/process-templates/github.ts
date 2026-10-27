/**
 * GitHub Process Template Configuration (#567)
 *
 * GitHub is not an Azure DevOps process, but ZapDesk shows GitHub issues
 * beside DevOps work items and has to describe their states somewhere. Listing
 * it here puts it in front of an admin alongside Agile, Scrum and the rest,
 * instead of leaving GitHub boards as the one source whose states are
 * undocumented.
 *
 * An issue is only `open` or `closed`. The statuses in between -- Open, In
 * Progress, Pending, Resolved -- are carried in labels, which is what
 * `lib/github-process.ts` maps in both directions. That module is the single
 * definition; this file presents it in the shape the admin page reads, so the
 * two cannot drift apart.
 */

import type { ProcessTemplateConfig } from './index';
import { GITHUB_PROCESS_NAME, GITHUB_STATES } from '@/lib/github-process';

/** The template's state names in one of DevOps's categories. */
const named = (category: string): string[] =>
  GITHUB_STATES.filter((state) => state.category === category).map((state) => state.name);

export const gitHubConfig: ProcessTemplateConfig = {
  name: GITHUB_PROCESS_NAME,
  id: 'github',

  workItemTypes: {
    // An issue is the only thing ZapDesk reads from GitHub. Pull requests come
    // from the same endpoint and are dropped.
    ticketTypes: ['Issue'],
    defaultTicketType: 'Issue',

    // GitHub has neither: no feature type, and no epic. Milestones are the
    // nearest thing and they are not a work item type, so claiming one here
    // would be describing something that does not exist.
  },

  fields: {
    // GitHub has no priority field. Repositories express it with labels, and
    // which labels those are differs per repository, so there is nothing
    // ZapDesk can read for every one of them.
  },

  // Derived from the one definition in `lib/github-process.ts` rather than
  // written out again: a second copy is a second thing to keep in step.
  states: {
    new: named('Proposed'),
    active: named('InProgress'),
    resolved: named('Resolved'),
    closed: named('Completed'),
    // Nothing is removed on GitHub. A closed issue stays readable, and
    // `state_reason: not_planned` is the nearest thing -- which ZapDesk reads
    // as Closed, because to a support desk it is.
    removed: [],
  },

  defaultState: 'New',
};
