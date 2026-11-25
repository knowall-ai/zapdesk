// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RequiredFieldsDialog from './RequiredFieldsDialog';
import type { RequiredField } from '@/hooks/useWorkItemActions';

/**
 * Optional fields in the move dialog: approval, once its rule was switched
 * off. The user can fill them in, or skip them and move anyway.
 */

afterEach(() => {
  cleanup();
});

const APPROVED_DATE: RequiredField = {
  referenceName: 'Custom.ApprovedDate',
  name: 'Approved Date',
  type: 'dateTime',
  optional: true,
};
const REASON: RequiredField = { referenceName: 'Custom.Reason', name: 'Reason', type: 'string' };

function renderPrompt(fields: RequiredField[], values: Record<string, string> = {}) {
  const onConfirm = vi.fn(async () => {});
  render(
    <RequiredFieldsDialog
      targetType="Active"
      changing="state"
      requiredFields={fields}
      fieldValues={values}
      onFieldChange={() => {}}
      onConfirm={onConfirm}
      onCancel={() => {}}
      isUpdating={false}
      members={[]}
      memberSearch=""
      onMemberSearchChange={() => {}}
      filteredMembers={[]}
    />
  );
  return onConfirm;
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('RequiredFieldsDialog with optional fields', () => {
  it('says the fields are optional and offers Skip', () => {
    renderPrompt([APPROVED_DATE]);

    expect(screen.getByLabelText('Approved Date (optional)')).toBeTruthy();
    expect(screen.getByText(/skip them and move the ticket/)).toBeTruthy();
    expect(button('Skip and move').disabled).toBe(false);
  });

  it('moves without them on Skip', () => {
    const onConfirm = renderPrompt([APPROVED_DATE]);

    fireEvent.click(button('Skip and move'));

    expect(onConfirm).toHaveBeenCalledWith({ skipOptional: true });
  });

  it('waits for a value before the main button moves with it', () => {
    renderPrompt([APPROVED_DATE]);
    expect(button('Move to Active').disabled).toBe(true);

    cleanup();
    const onConfirm = renderPrompt([APPROVED_DATE], { 'Custom.ApprovedDate': '2026-11-18' });
    fireEvent.click(button('Move to Active'));
    expect(onConfirm).toHaveBeenCalledWith();
  });

  it('still requires a required field, even on Skip', () => {
    renderPrompt([REASON, APPROVED_DATE]);

    expect(screen.getByLabelText('Reason *')).toBeTruthy();
    expect(button('Skip and move').disabled).toBe(true);
    expect(button('Move to Active').disabled).toBe(true);
  });

  it('shows no Skip when every field is required', () => {
    renderPrompt([REASON]);

    expect(screen.queryByRole('button', { name: 'Skip and move' })).toBeNull();
  });
});
