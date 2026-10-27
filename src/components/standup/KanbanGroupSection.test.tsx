// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StandupColumn } from '@/types';

/**
 * The group board on the Kanban page.
 *
 * `globals.css` styles it through `.kanban-group`: that selector is what makes
 * the state columns sit flush and share their borders (#305). The class is a
 * contract between the stylesheet and this component, and nothing else checks
 * it -- a rendered class name is invisible to the type checker, the build and
 * every other test -- so it is asserted here.
 */
vi.mock('@/components/providers/OrganizationProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
  useOrganization: () => ({
    organizations: [],
    selectedOrganization: { name: 'KnowAll', id: 'org1' },
    setSelectedOrganization: () => {},
    isLoading: false,
    error: null,
    refetch: async () => {},
  }),
}));

import KanbanGroupSection from './KanbanGroupSection';

const columns: StandupColumn[] = [
  { name: 'Active', category: 'InProgress', items: [] },
  { name: 'Resolved', category: 'Resolved', items: [] },
];

afterEach(cleanup);

describe('KanbanGroupSection', () => {
  it('carries the class its stylesheet targets', () => {
    const { container } = render(<KanbanGroupSection groupName="Internal" columns={columns} />);

    expect(container.querySelector('.kanban-group')).not.toBeNull();
  });

  it('names the group', () => {
    render(<KanbanGroupSection groupName="Internal" columns={columns} />);

    expect(screen.getByText('Internal')).toBeDefined();
  });
});
