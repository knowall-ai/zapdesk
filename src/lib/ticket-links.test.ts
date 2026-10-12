import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// The ticket detail route is /tickets/[id] — one segment, and it resolves the
// project itself. A link carrying the project too matches no route and 404s,
// which is invisible until somebody clicks it (issue #432). Every other ticket
// link in the app is already single-segment; this keeps it that way.
describe('ticket detail links', () => {
  it('never include a second path segment', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(/`\/tickets\/[^`]*`/g)) {
        const path = match[0];
        // Two interpolations means project + id, which is the bug.
        if ((path.match(/\$\{/g) ?? []).length > 1) {
          offenders.push(`${file}: ${path}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
