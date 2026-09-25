/**
 * Construction of GitHub links, primarily the prefilled "new issue" URLs the
 * app offers when it hits something it cannot handle.
 *
 * The URLs used to be written out by hand at each call site, which is how one
 * of them ended up pointing at `knowall-ai/devdesk` — the repository's former
 * name — long after the rename. Building them in one place with a configurable
 * repository is what stops that recurring (#186).
 */

/** Repository used when `NEXT_PUBLIC_GITHUB_REPO_URL` is unset or unusable. */
const DEFAULT_REPO_URL = 'https://github.com/knowall-ai/zapdesk';

/**
 * Base URL of the repository issues are filed against.
 *
 * Read from `NEXT_PUBLIC_GITHUB_REPO_URL`, falling back to this repository.
 * A configured value is only honoured when it is an `http(s)` URL: the result
 * is interpolated straight into an `href`, so accepting an arbitrary string
 * would let a bad deployment value turn every one of these links into a
 * `javascript:` payload. Anything else is ignored in favour of the default.
 *
 * Trailing slashes and a `.git` suffix are tolerated in any combination, since
 * both are what you get from copying a clone URL out of GitHub.
 */
export function githubRepoUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_GITHUB_REPO_URL || '').trim();
  if (!configured) return DEFAULT_REPO_URL;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    console.warn(
      `[GitHub] NEXT_PUBLIC_GITHUB_REPO_URL is not a valid URL (${configured}) — using ${DEFAULT_REPO_URL}.`
    );
    return DEFAULT_REPO_URL;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.warn(
      `[GitHub] NEXT_PUBLIC_GITHUB_REPO_URL must be an http(s) URL (${configured}) — using ${DEFAULT_REPO_URL}.`
    );
    return DEFAULT_REPO_URL;
  }

  // Slashes first: `.../repo.git/` would otherwise keep its `.git`, because
  // the suffix only matches at the very end of the string.
  return configured
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

/** Fields GitHub's new-issue form accepts as query parameters. */
export interface NewIssueOptions {
  title: string;
  body?: string;
  /** Applied only if they already exist on the repository; GitHub ignores the rest. */
  labels?: readonly string[];
}

/**
 * A link to GitHub's new-issue form, prefilled.
 *
 * Every value goes through `URLSearchParams`, so titles and bodies carrying
 * `&`, `#`, newlines or non-ASCII survive intact rather than truncating the
 * query — hand-escaping these is the other half of what #186 set out to stop.
 */
export function newIssueUrl(options: NewIssueOptions): string {
  const url = new URL(`${githubRepoUrl()}/issues/new`);
  url.searchParams.set('title', options.title);
  if (options.body) url.searchParams.set('body', options.body);

  const labels = (options.labels ?? []).map((l) => l.trim()).filter(Boolean);
  if (labels.length > 0) url.searchParams.set('labels', labels.join(','));

  return url.toString();
}

/**
 * The "request support for this process template" link shown wherever ZapDesk
 * meets a process template it has no configuration for.
 *
 * Naming the template in the issue is the point: the previous fixed title
 * produced a pile of identical reports that said nothing about which template
 * was actually wanted.
 */
export function templateSupportIssueUrl(templateName?: string): string {
  const named = templateName?.trim();
  return newIssueUrl({
    title: named ? `Support for process template: ${named}` : 'Support for a new process template',
    body: named
      ? `ZapDesk does not yet support the "${named}" process template.\n\nRaised from the app.`
      : undefined,
    labels: ['enhancement'],
  });
}
