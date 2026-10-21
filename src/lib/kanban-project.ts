/**
 * One project's board (#7377): a support board without other projects' items.
 *
 * The Kanban board shows every project; `?project=<name>` keeps just one. The
 * summary tiles are counted again from what remains, so they describe the
 * board on screen.
 */
import type { StandupData } from '@/types';

/** The board narrowed to one project (name matched without regard to case), or as is. */
export function filterStandupByProject(
  data: StandupData | null,
  project: string | null
): StandupData | null {
  if (!data || !project) return data;
  const wanted = project.trim().toLowerCase();
  const projects = data.projects.filter((p) => p.projectName.toLowerCase() === wanted);
  const columnCounts: Record<string, number> = {};
  for (const column of data.columns) columnCounts[column.name] = 0;
  for (const p of projects) {
    for (const column of p.columns) {
      columnCounts[column.name] = (columnCounts[column.name] ?? 0) + column.items.length;
    }
  }
  return { ...data, projects, summary: { columnCounts, projectCount: projects.length } };
}

/**
 * The project an address asks for, written as the board names it: trimmed
 * and matched without regard to case. An unknown name is kept as typed, so
 * the board can say it has nothing for it; null when none is asked for.
 */
export function canonicalProject(
  requested: string | null,
  names: readonly string[]
): string | null {
  const wanted = requested?.trim();
  if (!wanted) return null;
  return names.find((name) => name.toLowerCase() === wanted.toLowerCase()) ?? wanted;
}
