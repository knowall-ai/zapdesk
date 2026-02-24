/**
 * T-Minus-15 Process Template Configuration
 *
 * KnowAll's custom Azure DevOps process template.
 * Based on Agile template with custom modifications.
 */

import type { ProcessTemplateConfig } from './index';

export const tMinus15Config: ProcessTemplateConfig = {
  name: 'T-Minus-15',
  id: 't-minus-15',

  workItemTypes: {
    // Ticket types - must be tagged with "ticket" to appear in ZapDesk
    ticketTypes: ['Task', 'Bug', 'Enhancement', 'Issue'],
    defaultTicketType: 'Task',

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
    new: ['New', 'To Do'],
    active: ['Active', 'In Progress', 'Committed', 'Approved'],
    resolved: ['Resolved'],
    closed: ['Closed', 'Done'],
    removed: ['Removed'],
  },

  defaultState: 'New',
};
