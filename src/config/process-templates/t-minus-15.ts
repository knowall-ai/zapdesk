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
    ticket: 'Task', // Default type for creating support tickets
    supportedTypes: ['Task', 'Bug', 'Enhancement', 'Issue', 'User Story', 'Feature', 'Epic'],
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
    proposed: ['New', 'To Do'],
    inProgress: ['Active', 'In Progress', 'Committed', 'Approved'],
    resolved: ['Resolved', 'Done'],
    closed: ['Closed'],
    removed: ['Removed'],
  },

  defaultState: 'New',
};
