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

  // #705: a named repository past its page caps is reported too, but naming
  // it again would not help, so the advice is left out.
  it('names a repository read in part without advice that would not help', () => {
    const message = gitHubTruncationMessage(['acme/portal']);
    expect(message).toContain('acme/portal');
    expect(message).toContain('may be missing');
    expect(message).not.toContain('Map the repositories');
  });
});
