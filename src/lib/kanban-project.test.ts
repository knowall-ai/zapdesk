import { describe, it, expect } from 'vitest';
import { canonicalProject, filterStandupByProject } from './kanban-project';
import type { StandupData } from '@/types';

const item = (id: number) => ({ id }) as never;
const data = {
  date: '2026-10-21',
  columns: [
    { name: 'New', category: 'Proposed' },
    { name: 'Active', category: 'InProgress' },
  ],
  projects: [
    {
      projectName: 'Internal',
      columns: [
        { name: 'New', category: 'Proposed', items: [item(1), item(2)] },
        { name: 'Active', category: 'InProgress', items: [item(3)] },
      ],
    },
    {
      projectName: 'Belfast Trust',
      columns: [{ name: 'New', category: 'Proposed', items: [item(4)] }],
    },
  ],
  summary: { columnCounts: { New: 3, Active: 1 }, projectCount: 2 },
} as unknown as StandupData;

describe('filterStandupByProject (#7377)', () => {
  it('keeps only the chosen project and recounts the tiles', () => {
    const board = filterStandupByProject(data, 'internal')!;
    expect(board.projects.map((p) => p.projectName)).toEqual(['Internal']);
    expect(board.summary).toEqual({ columnCounts: { New: 2, Active: 1 }, projectCount: 1 });
  });

  it('shows everything when no project is chosen', () => {
    expect(filterStandupByProject(data, null)).toBe(data);
  });

  it('shows an empty board for a project with nothing on it', () => {
    const board = filterStandupByProject(data, 'HSE')!;
    expect(board.projects).toEqual([]);
    expect(board.summary).toEqual({ columnCounts: { New: 0, Active: 0 }, projectCount: 0 });
  });
});

describe('canonicalProject', () => {
  const names = ['Belfast Trust', 'Internal'];
  it('names the project as the board does', () => {
    expect(canonicalProject('  internal ', names)).toBe('Internal');
  });
  it('keeps an unknown project as typed, and none as null', () => {
    expect(canonicalProject('HSE', names)).toBe('HSE');
    expect(canonicalProject('  ', names)).toBeNull();
    expect(canonicalProject(null, names)).toBeNull();
  });
});
