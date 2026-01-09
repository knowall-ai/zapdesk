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
    ticket: 'Issue', // Basic uses Issue for general items (no Task type by default)
    supportedTypes: ['Issue', 'Task', 'Epic'],
  },

  fields: {
    // Basic template does NOT have Priority field
    priority: undefined,
    priorityValues: undefined,
  },

  states: {
    proposed: ['To Do'],
    inProgress: ['Doing'],
    resolved: ['Done'],
    closed: ['Done'], // Basic doesn't have separate Closed state
    removed: [], // Basic doesn't have Removed state
  },

  defaultState: 'To Do',
};
