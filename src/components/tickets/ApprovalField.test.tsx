// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * Approved By and Approved Date in the details panel, below Type: editable
 * for a type that has the fields, read-only otherwise.
 */

const get = vi.fn();
vi.mock('@/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks')>()),
  useDevOpsApi: () => ({ get, selectedOrganization: { accountName: 'KnowAllTest' } }),
}));

import ApprovalField from './ApprovalField';

const alex = { id: 'a1', displayName: 'Alex Morgan', email: 'alex@example.com' };

/** Answers the field lookup with `hasFields`, and the members request. */
function answer(hasFields: boolean) {
  get.mockImplementation(async (url: string) => {
    if (url.includes('/fields/')) return new Response('{}', { status: hasFields ? 200 : 404 });
    if (url.endsWith('/members')) return new Response(JSON.stringify({ members: [alex] }));
    return new Response('{}', { status: 404 });
  });
}

afterEach(() => {
  cleanup();
  get.mockReset();
});

describe('ApprovalField', () => {
  it('lets an approver be picked for a type with the fields', async () => {
    answer(true);
    const onSave = vi.fn(async () => {});
    render(<ApprovalField project="Contoso" workItemType="Bug" onSave={onSave} />);

    fireEvent.click(await screen.findByRole('button', { name: /Not approved/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Alex Morgan/ }));

    expect(onSave).toHaveBeenCalledWith({ approvedBy: 'Alex Morgan <alex@example.com>' });
  });

  it('saves the day when the date field is left', async () => {
    answer(true);
    const onSave = vi.fn(async () => {});
    render(<ApprovalField project="ABC Inc" workItemType="Bug" onSave={onSave} />);

    const date = await screen.findByLabelText('Approved Date');
    fireEvent.change(date, { target: { value: '2026-11-18' } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(date);

    expect(onSave).toHaveBeenCalledWith({ approvedDate: '2026-11-18' });
  });

  it('clears a set day', async () => {
    answer(true);
    const onSave = vi.fn(async () => {});
    render(
      <ApprovalField
        project="DEF Inc"
        workItemType="Bug"
        approvedDate="2026-11-18T00:00:00Z"
        onSave={onSave}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Clear approved date' }));

    expect(onSave).toHaveBeenCalledWith({ approvedDate: null });
  });

  it('shows nothing to edit for a type without the fields', async () => {
    answer(false);
    const { container } = render(
      <ApprovalField project="Contoso" workItemType="Task" onSave={vi.fn()} />
    );

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('is read-only without a way to save', () => {
    answer(true);
    render(<ApprovalField project="Contoso" workItemType="Bug" approvedBy={alex} />);

    expect(screen.getByText('Alex Morgan')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
