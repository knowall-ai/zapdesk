import { describe, it, expect } from 'vitest';
import { gitHubTruncationMessage } from './github-truncation';

// The notice for an organization read only in part (#621).
describe('gitHubTruncationMessage', () => {
  it('says nothing when every organization was read in full', () => {
    expect(gitHubTruncationMessage([])).toBeNull();
  });

  it('names the organizations and how to see the missing issues', () => {
    const message = gitHubTruncationMessage(['acme/*', 'contoso/*']);
    expect(message).toContain('acme/*, contoso/*');
    expect(message).toContain('may be missing');
    expect(message).toContain('Map the repositories you need by name');
  });
});
