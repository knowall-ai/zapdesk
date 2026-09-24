import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { githubRepoUrl, newIssueUrl, templateSupportIssueUrl } from './github';

const DEFAULT = 'https://github.com/knowall-ai/zapdesk';

// Save and restore rather than just deleting: a developer with this set in
// their shell would otherwise see the unset-case tests fail here and have the
// variable silently removed from the rest of the run.
const original = process.env.NEXT_PUBLIC_GITHUB_REPO_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_GITHUB_REPO_URL;
});

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_GITHUB_REPO_URL;
  else process.env.NEXT_PUBLIC_GITHUB_REPO_URL = original;
  vi.restoreAllMocks();
});

describe('githubRepoUrl', () => {
  it('falls back to this repository when unset', () => {
    expect(githubRepoUrl()).toBe(DEFAULT);
  });

  it('uses a configured repository', () => {
    process.env.NEXT_PUBLIC_GITHUB_REPO_URL = 'https://github.com/acme/helpdesk';
    expect(githubRepoUrl()).toBe('https://github.com/acme/helpdesk');
  });

  it('tolerates the trailing slash and .git you get from a clone URL', () => {
    const expected = 'https://github.com/acme/helpdesk';
    for (const configured of [
      'https://github.com/acme/helpdesk.git',
      'https://github.com/acme/helpdesk///',
      // Both at once. Stripping `.git` first leaves it in place, because the
      // suffix only matches at the end of the string.
      'https://github.com/acme/helpdesk.git/',
      'https://github.com/acme/helpdesk.git///',
    ]) {
      process.env.NEXT_PUBLIC_GITHUB_REPO_URL = configured;
      expect(githubRepoUrl(), configured).toBe(expected);
    }
  });

  it('treats blank and whitespace-only values as unset', () => {
    process.env.NEXT_PUBLIC_GITHUB_REPO_URL = '   ';
    expect(githubRepoUrl()).toBe(DEFAULT);
  });

  // The value lands in an href. A deployment that sets it to a script URL must
  // not turn every one of these links into an XSS vector.
  it('refuses a non-http(s) scheme', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_GITHUB_REPO_URL = 'javascript:alert(1)';
    expect(githubRepoUrl()).toBe(DEFAULT);
    expect(warn).toHaveBeenCalled();
  });

  it('refuses a value that is not a URL at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_GITHUB_REPO_URL = 'knowall-ai/zapdesk';
    expect(githubRepoUrl()).toBe(DEFAULT);
    expect(warn).toHaveBeenCalled();
  });
});

describe('newIssueUrl', () => {
  it('points at the new-issue form with the title set', () => {
    const url = new URL(newIssueUrl({ title: 'Something broke' }));
    expect(url.origin + url.pathname).toBe(`${DEFAULT}/issues/new`);
    expect(url.searchParams.get('title')).toBe('Something broke');
  });

  it('omits body and labels when not given', () => {
    const url = new URL(newIssueUrl({ title: 'Bare' }));
    expect(url.searchParams.has('body')).toBe(false);
    expect(url.searchParams.has('labels')).toBe(false);
  });

  it('joins labels with commas and drops blank ones', () => {
    const url = new URL(newIssueUrl({ title: 'x', labels: ['enhancement', ' ', ' bug '] }));
    expect(url.searchParams.get('labels')).toBe('enhancement,bug');
  });

  // The whole point of the utility: hand-escaped URLs truncated on the first
  // `&` and mangled anything non-ASCII.
  it('survives characters that would break a hand-built query', () => {
    const title = 'Tickets & "quotes" #42 — 50% of the time';
    const body = 'Line one\nLine two & three\nEmoji: 🚀';
    const url = new URL(newIssueUrl({ title, body }));
    expect(url.searchParams.get('title')).toBe(title);
    expect(url.searchParams.get('body')).toBe(body);
  });

  it('builds against a configured repository', () => {
    process.env.NEXT_PUBLIC_GITHUB_REPO_URL = 'https://github.example.com/acme/helpdesk';
    expect(newIssueUrl({ title: 'x' })).toContain(
      'https://github.example.com/acme/helpdesk/issues/new'
    );
  });
});

describe('templateSupportIssueUrl', () => {
  it('names the template in the title and body', () => {
    const url = new URL(templateSupportIssueUrl('Basic'));
    expect(url.searchParams.get('title')).toBe('Support for process template: Basic');
    expect(url.searchParams.get('body')).toContain('"Basic"');
    expect(url.searchParams.get('labels')).toBe('enhancement');
  });

  it('falls back to a generic title when the template is unknown', () => {
    const url = new URL(templateSupportIssueUrl());
    expect(url.searchParams.get('title')).toBe('Support for a new process template');
    expect(url.searchParams.has('body')).toBe(false);
  });

  it('treats a whitespace-only template name as unknown', () => {
    const url = new URL(templateSupportIssueUrl('   '));
    expect(url.searchParams.get('title')).toBe('Support for a new process template');
  });

  // The old link was written by hand and still pointed at the repository's
  // former name months after the rename.
  it('no longer points at the old devdesk repository', () => {
    expect(templateSupportIssueUrl('Agile')).not.toContain('devdesk');
  });
});
