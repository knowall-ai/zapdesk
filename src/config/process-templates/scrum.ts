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
    ticket: 'Product Backlog Item', // Scrum uses PBIs for backlog items
    supportedTypes: ['Product Backlog Item', 'Bug', 'Task', 'Feature', 'Epic', 'Impediment'],
  },

  fields: {
    priority: 'Microsoft.VSTS.Common.Priority',
    priorityValues: {
      1: 'Urgent',
      2: 'High',
      3: 'Medium',
      4: 'Low',
    },
  },

  states: {
    proposed: ['New'],
    inProgress: ['Approved', 'Committed', 'In Progress'],
    resolved: ['Done'],
    closed: ['Done', 'Removed'],
    removed: ['Removed'],
  },

  defaultState: 'New',
};
