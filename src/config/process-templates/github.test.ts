import { describe, it, expect } from 'vitest';
import { gitHubConfig } from './github';
import { getTemplateConfig, isTemplateSupported, getSupportedTemplates } from './index';
import { GITHUB_STATES, gitHubStatusFor } from '@/lib/github-process';

/**
 * GitHub listed beside the Azure DevOps process templates (#567).
 *
 * GitHub is not a DevOps process, but ZapDesk shows its issues on the same
 * boards and in the same lists, so an admin should be able to see what their
 * states mean here rather than GitHub being the one undocumented source.
 */

describe('the template is registered', () => {
  it('is found by name, however it is typed', () => {
    expect(getTemplateConfig('GitHub').id).toBe('github');
    expect(getTemplateConfig('github').id).toBe('github');
    expect(isTemplateSupported('GitHub')).toBe(true);
  });

  it('is listed with the others', () => {
    expect(getSupportedTemplates()).toContain('GitHub');
  });
});

describe('what it says GitHub has', () => {
  it('reads issues and nothing else', () => {
    expect(gitHubConfig.workItemTypes.ticketTypes).toEqual(['Issue']);
    expect(gitHubConfig.workItemTypes.defaultTicketType).toBe('Issue');
  });

  it('claims no feature or epic type, because GitHub has neither', () => {
    // A milestone is the nearest thing and is not a work item type. Naming
    // one would describe something that does not exist.
    expect(gitHubConfig.workItemTypes.featureType).toBeUndefined();
    expect(gitHubConfig.workItemTypes.epicType).toBeUndefined();
  });

  it('claims no priority field', () => {
    // Repositories express priority with labels, and which labels differs per
    // repository, so there is nothing ZapDesk can read for all of them.
    expect(gitHubConfig.fields.priority).toBeUndefined();
  });

  it('has no removed state', () => {
    // Nothing is removed on GitHub. `not_planned` is the nearest thing, and
    // ZapDesk reads it as Closed, because to a support desk it is.
    expect(gitHubConfig.states.removed).toEqual([]);
  });
});

describe('the states match the mapping they are read from', () => {
  // Two lists of the same states is two places to be wrong, so this file
  // derives its states from `lib/github-process.ts`. These check it stayed
  // derived, and that each bucket holds what its category means.
  it('places every state under the category the mapping gives it', () => {
    expect(gitHubConfig.states.new).toEqual(['New']);
    expect(gitHubConfig.states.active).toEqual(['Open', 'In Progress', 'Pending']);
    expect(gitHubConfig.states.resolved).toEqual(['Resolved']);
    expect(gitHubConfig.states.closed).toEqual(['Closed']);
  });

  it('lists every state the mapping defines, and no others', () => {
    const listed = [
      ...gitHubConfig.states.new,
      ...gitHubConfig.states.active,
      ...gitHubConfig.states.resolved,
      ...gitHubConfig.states.closed,
      ...gitHubConfig.states.removed,
    ].sort();

    expect(listed).toEqual(GITHUB_STATES.map((s) => s.name).sort());
  });

  it('starts a new issue in the state an unread issue actually reads as', () => {
    // An open issue nobody has picked up. If these disagreed, the template
    // would claim a starting state the board never shows.
    expect(gitHubConfig.defaultState).toBe('New');
    expect(gitHubStatusFor({ state: 'open' })).toBe('New');
  });
});
