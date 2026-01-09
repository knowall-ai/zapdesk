/**
 * Basic Process Template Configuration
 *
 * Azure DevOps Basic process template.
 * Simpler than Agile/Scrum with fewer work item types and states.
 * Note: Basic template does NOT have a Priority field.
 */

import type { ProcessTemplateConfig } from './index';

export const basicConfig: ProcessTemplateConfig = {
  name: 'Basic',
  id: 'basic',

  workItemTypes: {
    // Ticket types - must be tagged with "ticket" to appear in DevDesk
    ticketTypes: ['Issue', 'Task'],
    defaultTicketType: 'Issue',

    // Feature type - Basic template does NOT have Feature type
    featureType: undefined,

    // Epic type
    epicType: 'Epic',
  },

  fields: {
    // Basic template does NOT have Priority field
    priority: undefined,
    priorityValues: undefined,
  },

  states: {
    new: ['To Do'],
    active: ['Doing'],
    resolved: [], // Basic doesn't have a Resolved state
    closed: ['Done'],
    removed: [], // Basic doesn't have Removed state
  },

  defaultState: 'To Do',
};
