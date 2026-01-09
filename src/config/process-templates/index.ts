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
  // Note: Tickets are work items tagged with "ticket" tag
  workItemTypes: {
    // Ticket types - work items that can be tagged as "ticket" for support tracking
    ticketTypes: string[]; // Supported types for tickets (e.g., ["Task", "Bug", "Issue"])
    defaultTicketType: string; // Default type when creating new tickets

    // Feature type - for feature-level planning (undefined if not available)
    featureType?: string;

    // Epic type - for epic-level planning
    epicType: string;
  };

  // Field mappings
  fields: {
    priority?: string; // Field ref for priority (undefined if not supported)
    priorityValues?: Record<number, string>; // Map numeric values to display names
  };

  // State mappings - map actual DevOps states to our UI categories
  states: {
    new: string[]; // States that mean "new/to do"
    active: string[]; // States that mean "in progress/active"
    resolved: string[]; // States that mean "resolved" (not all templates have this)
    closed: string[]; // States that mean "closed/done/completed"
    removed: string[]; // States that mean "removed/cancelled"
  };

  // Default state for new tickets
  defaultState: string;
}

// State categories used internally
export type StateCategory = 'New' | 'Active' | 'Resolved' | 'Closed' | 'Removed';

// Import template configs
import { tMinus15Config } from './t-minus-15';
import { basicConfig } from './basic';
import { scrumConfig } from './scrum';

// Registry of all supported templates
// Key is normalized template name (lowercase, hyphens)
const templates: Record<string, ProcessTemplateConfig> = {
  't-minus-15': tMinus15Config,
  basic: basicConfig,
  scrum: scrumConfig,
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
  if (config.states.new.includes(state)) return 'New';
  if (config.states.active.includes(state)) return 'Active';
  if (config.states.resolved.includes(state)) return 'Resolved';
  if (config.states.closed.includes(state)) return 'Closed';
  if (config.states.removed.includes(state)) return 'Removed';
  return 'Active'; // Default fallback for unknown states
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
export { scrumConfig } from './scrum';
