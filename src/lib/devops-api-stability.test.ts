import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the fix behind "the page is being updated each time I change tabs"
 * (#7391) and "constant page update" (#7721), shipped in PR #473.
 *
 * The cause was identity, not fetching. `refresh` from the ticket counts
 * provider changes whenever the access token does, about hourly. While it was a
 * dependency of `fetchDevOps`, every helper built on it was rebuilt too, so any
 * page effect keyed on `get` refetched the whole page -- on a token refresh,
 * and on returning to a tab, which is when the browser refreshes the session.
 *
 * Putting `refresh` behind a ref fixed it. Nothing stops it being added back to
 * the dependency array, and nothing would fail if it were: the app still works,
 * it just reloads constantly again. There is no hook-testing setup in this repo
 * (vitest runs in `node` and only picks up `.ts`), so the source is checked
 * directly, the same way `work-item-fields.test.ts` guards its field list.
 */
const source = readFileSync(join(__dirname, '..', 'hooks', 'useDevOpsApi.ts'), 'utf8');

/** The dependency array of the first useCallback in the file. */
function fetchDevOpsDeps(): string {
  const start = source.indexOf('const fetchDevOps = useCallback(');
  expect(start, 'fetchDevOps should still be a useCallback').toBeGreaterThan(-1);
  const after = source.slice(start);
  const deps = after.match(/\n\s*\[([^\]]*)\]\s*\)/);
  expect(deps, 'fetchDevOps should still have a dependency array').not.toBeNull();
  return (deps as RegExpMatchArray)[1];
}

describe('useDevOpsApi keeps its helpers stable (#7391, #7721)', () => {
  it('does not depend on the counts refresh', () => {
    // The whole bug: `refreshCounts` here rebuilds every helper hourly.
    expect(fetchDevOpsDeps()).not.toContain('refreshCounts');
  });

  it('depends on the selected organization, which is what should rebuild it', () => {
    expect(fetchDevOpsDeps()).toContain('selectedOrganization');
  });

  it('reads the refresh through a ref at call time', () => {
    expect(source).toContain('const refreshCountsRef = useRef(refreshCounts)');
    expect(source).toContain('refreshCountsRef.current()');
  });

  it('keeps the ref current, so writes still trigger the latest refresh', () => {
    // A ref that is never updated would silently call a stale refresh for the
    // life of the page, which is worse than the bug it replaced.
    expect(source).toMatch(/refreshCountsRef\.current = refreshCounts/);
    expect(source).toMatch(/\}, \[refreshCounts\]\)/);
  });

  it('refreshes the counts only after a successful write', () => {
    // The ref exists to keep #404 working: a write moves tickets between
    // sidebar buckets, so the counts must still be invalidated.
    //
    // Asserting the guard and the call separately is not enough -- the call
    // could sit outside the guard, refreshing on every GET and on failed
    // writes, and both assertions would still pass. So the guard and the call
    // are matched as one statement.
    expect(source).toMatch(
      /if \(method !== 'GET' && response\.ok\)\s*\{?\s*refreshCountsRef\.current\(\);?/
    );
  });

  it('refreshes from exactly one place, so none is left unguarded', () => {
    const calls = source.match(/refreshCountsRef\.current\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('calls the refresh only through the ref, never the captured value', () => {
    // `refreshCounts()` anywhere below the ref would reintroduce the capture.
    const body = source.slice(source.indexOf('const refreshCountsRef'));
    const direct = body.match(/(?<!Ref\.current|\w)refreshCounts\(\)/g) ?? [];
    expect(direct).toEqual([]);
  });
});
