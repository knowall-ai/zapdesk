/**
 * Agile Process Template Configuration
 *
 * Azure DevOps Agile process template (Microsoft standard).
 * Uses User Stories, Bugs, and Tasks with traditional Agile states.
 * Note: Agile template uses Priority field (Microsoft.VSTS.Common.Priority).
 */

import type { ProcessTemplateConfig } from './index';

export const agileConfig: ProcessTemplateConfig = {
  name: 'Agile',
  id: 'agile',

  workItemTypes: {
    // Ticket types - must be tagged with "ticket" to appear in DevDesk
    ticketTypes: ['User Story', 'Bug', 'Task', 'Issue'],
    defaultTicketType: 'User Story',

    // Feature and Epic types for hierarchy
    featureType: 'Feature',
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
  },

  states: {
    new: ['New'],
    active: ['Active'],
    resolved: ['Resolved'],
    closed: ['Closed'],
    removed: ['Removed'],
  },

  defaultState: 'New',
};
