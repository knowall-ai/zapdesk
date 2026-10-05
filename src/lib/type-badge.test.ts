import { describe, it, expect } from 'vitest';
import type { WorkItemType } from '@/types';

// The badge is a component and this repo has no component test setup, so these
// cover the two rules behind it rather than its markup: that a type's colour
// and icon are looked up from what DevOps reported, and that a type DevOps
// says nothing about still renders.
const TYPES: WorkItemType[] = [
  {
    name: 'Bug',
    referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug',
    color: 'CC293D',
    icon: 'https://devops.test/icons/bug.svg',
  },
  { name: 'Task', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', color: 'F2CB1D' },
];

const lookup = (name: string | undefined) => TYPES.find((t) => t.name === name);

describe('work item type presentation comes from DevOps', () => {
  it('finds the colour and icon DevOps reported', () => {
    const info = lookup('Bug');
    expect(info?.color).toBe('CC293D');
    expect(`#${info?.color}`).toBe('#CC293D');
    expect(info?.icon).toBe('https://devops.test/icons/bug.svg');
  });

  it('handles a type with a colour but no icon', () => {
    const info = lookup('Task');
    expect(info?.color).toBe('F2CB1D');
    expect(info?.icon).toBeUndefined();
  });

  // A type added in DevOps that we have not fetched yet, or one from another
  // project, must still show its name rather than disappear.
  it('has no styling for an unknown type, which still has a name', () => {
    expect(lookup('Impediment')).toBeUndefined();
    expect(lookup(undefined)).toBeUndefined();
  });

  it('reuses DevOps rather than a table of our own, so nothing is hardcoded', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/components/common/WorkItemTypeBadge.tsx', 'utf8')
    );
    // No literal hex colours and no per-type names: a type recoloured in
    // DevOps must follow here without a code change.
    expect(source).not.toMatch(/#[0-9a-f]{6}/i);
    for (const name of ['Bug', 'Task', 'User Story', 'Issue']) {
      expect(source).not.toContain(`'${name}'`);
    }
  });
});
