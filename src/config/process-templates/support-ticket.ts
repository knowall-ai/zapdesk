/**
 * Support Ticket Process Template Configuration (#569)
 *
 * An inherited Azure DevOps process whose states are ZapDesk's statuses, one
 * to one, rather than a development process ZapDesk has to translate.
 *
 * Every other template here was built for development work: Agile has Active
 * and Resolved, Scrum has Committed and Done, T-Minus-15 has Todo and Doing.
 * ZapDesk shows a support desk's statuses, so it translates by state
 * category -- and the translation has cost real bugs. `Pending` had to be
 * written as `Blocked` and read back out of it (#297, #391), and `Open` and
 * `In Progress` are the same category in most templates, so one of them was
 * always a guess.
 *
 * On this template there is nothing to guess: the state *is* the status.
 *
 * `Resolved` is deliberately not a state here. A support desk closes a
 * ticket when the customer is satisfied, and a separate Resolved state is
 * the thing nobody moves out of -- so tickets sit in it, and the SLA clock
 * stops against a state that does not mean the work is over. A project that
 * wants one can add it to its inherited process; `resolved` below is kept as
 * an empty list rather than removed, so that a project which does add it
 * still reads back correctly.
 *
 * The process is created in Azure DevOps, not here: see
 * `scripts/create-support-ticket-process.mjs` and docs/DEPLOYMENT.adoc.
 */

import type { ProcessTemplateConfig } from './index';

export const supportTicketConfig: ProcessTemplateConfig = {
  name: 'Support Ticket',
  id: 'support-ticket',

  workItemTypes: {
    // A single type, so a ticket cannot arrive as a Bug on one project and a
    // Task on another. The ticket tag still marks it, as everywhere else.
    ticketTypes: ['Ticket'],
    defaultTicketType: 'Ticket',

    // Support work is not planned in features; an epic is kept so a ticket
    // can still be rolled up to one where a project uses them.
    epicType: 'Epic',
  },

  fields: {
    priority: 'Microsoft.VSTS.Common.Priority',
    priorityValues: {
      1: 'Urgent',
      2: 'High',
      3: 'Normal',
      4: 'Low',
    },
    resolutionTypes: ['Ticket'],
  },

  states: {
    new: ['New'],
    // Open and In Progress are both InProgress to DevOps. They are different
    // to a support desk: Open is waiting on the team, In Progress is being
    // worked on now.
    active: ['Open', 'In Progress', 'Pending'],
    resolved: [],
    closed: ['Closed'],
    removed: ['Removed'],
  },

  defaultState: 'New',
};

/**
 * The states as the inherited process defines them, with the categories
 * DevOps files them under and what each means for the SLA clock.
 *
 * Exported for the creation script and for the tests that check this
 * template agrees with `state-categories.ts` -- the reading half of the
 * round trip lives there, and two halves that disagree is exactly the bug
 * this template exists to remove.
 */
export const SUPPORT_TICKET_STATES: ReadonlyArray<{
  name: string;
  category: 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';
  meaning: string;
  slaClock: 'running' | 'paused' | 'stopped';
}> = [
  {
    name: 'New',
    category: 'Proposed',
    meaning: 'Raised, not yet triaged',
    slaClock: 'running',
  },
  {
    name: 'Open',
    category: 'InProgress',
    meaning: 'Triaged or assigned, waiting on the support team',
    slaClock: 'running',
  },
  {
    name: 'In Progress',
    category: 'InProgress',
    meaning: 'Being worked on',
    slaClock: 'running',
  },
  {
    name: 'Pending',
    category: 'InProgress',
    meaning: 'Waiting on the customer or a third party',
    slaClock: 'paused',
  },
  {
    name: 'Closed',
    category: 'Completed',
    meaning: 'Solved, or closed without being solved',
    slaClock: 'stopped',
  },
];
