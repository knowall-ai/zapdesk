/**
 * Scrum Process Template Configuration
 *
 * Azure DevOps Scrum process template.
 * Uses Product Backlog Items, Bugs, and Tasks with Sprint-focused states.
 * Note: Scrum template uses Priority field (Microsoft.VSTS.Common.Priority).
 */

import type { ProcessTemplateConfig } from './index';

export const scrumConfig: ProcessTemplateConfig = {
  name: 'Scrum',
  id: 'scrum',

  workItemTypes: {
    // Ticket types - must be tagged with "ticket" to appear in ZapDesk
    ticketTypes: ['Product Backlog Item', 'Bug', 'Task', 'Impediment'],
    defaultTicketType: 'Product Backlog Item',

    // Feature and Epic types for hierarchy
    featureType: 'Feature',
    epicType: 'Epic',
  },

  fields: {
    priority: 'Microsoft.VSTS.Common.Priority',
    priorityValues: {
      1: 'Critical',
      2: 'High',
      3: 'Medium',
      4: 'Low',
    },
  },

  states: {
    new: ['New'],
    active: ['Approved', 'Committed', 'In Progress'],
    resolved: [], // Scrum doesn't have a Resolved state
    closed: ['Done'],
    removed: ['Removed'],
  },

  defaultState: 'New',
};
