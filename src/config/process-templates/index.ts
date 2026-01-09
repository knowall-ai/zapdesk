/**
 * Process Template Configuration System
 *
 * Azure DevOps supports multiple process templates (T-Minus-15, Basic, Agile, Scrum, CMMI)
 * each with different work item types, states, and fields. This configuration system
 * provides template-specific mappings for DevDesk.
 */

export interface ProcessTemplateConfig {
  name: string; // Display name
  id: string; // Unique identifier for matching

  // Work item types
  workItemTypes: {
    ticket: string; // Default type for creating tickets (e.g., "Task", "Issue")
    supportedTypes: string[]; // All types we can display
  };

  // Field mappings
  fields: {
    priority?: string; // Field ref for priority (undefined if not supported)
    priorityValues?: Record<number, string>; // Map numeric values to display names
  };

  // State mappings - map actual DevOps states to our UI categories
  states: {
    proposed: string[]; // States that mean "new/to do"
    inProgress: string[]; // States that mean "in progress/active"
    resolved: string[]; // States that mean "resolved/done"
    closed: string[]; // States that mean "closed/completed"
    removed: string[]; // States that mean "removed/cancelled"
  };

  // Default state for new tickets
  defaultState: string;
}

// State categories used internally
export type StateCategory = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';

// Import template configs
import { tMinus15Config } from './t-minus-15';
import { basicConfig } from './basic';

// Registry of all supported templates
// Key is normalized template name (lowercase, hyphens)
const templates: Record<string, ProcessTemplateConfig> = {
  't-minus-15': tMinus15Config,
  basic: basicConfig,
};

// Default template for backward compatibility
const DEFAULT_TEMPLATE = 't-minus-15';

/**
 * Normalize template name for matching
 * e.g., "T-Minus-15" -> "t-minus-15", "Basic" -> "basic"
 */
function normalizeTemplateName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Get configuration for a specific template
 * Falls back to default template if not found
 */
export function getTemplateConfig(templateName?: string): ProcessTemplateConfig {
  if (!templateName) return templates[DEFAULT_TEMPLATE];

  const normalized = normalizeTemplateName(templateName);
  return templates[normalized] || templates[DEFAULT_TEMPLATE];
}

/**
 * Check if a template is supported
 */
export function isTemplateSupported(templateName: string): boolean {
  const normalized = normalizeTemplateName(templateName);
  return normalized in templates;
}

/**
 * Get list of all supported template names
 */
export function getSupportedTemplates(): string[] {
  return Object.values(templates).map((t) => t.name);
}

/**
 * Map a DevOps state to our internal category
 */
export function getStateCategory(state: string, config: ProcessTemplateConfig): StateCategory {
  if (config.states.proposed.includes(state)) return 'Proposed';
  if (config.states.inProgress.includes(state)) return 'InProgress';
  if (config.states.resolved.includes(state)) return 'Resolved';
  if (config.states.closed.includes(state)) return 'Completed';
  if (config.states.removed.includes(state)) return 'Removed';
  return 'InProgress'; // Default fallback for unknown states
}

/**
 * Check if a template supports the Priority field
 */
export function hasPriorityField(config: ProcessTemplateConfig): boolean {
  return !!config.fields.priority;
}

/**
 * Get priority display name from numeric value
 */
export function getPriorityLabel(value: number, config: ProcessTemplateConfig): string | undefined {
  return config.fields.priorityValues?.[value];
}

// Re-export template configs for direct access if needed
export { tMinus15Config } from './t-minus-15';
export { basicConfig } from './basic';
