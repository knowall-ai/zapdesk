// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RequiredFieldsDialog from './RequiredFieldsDialog';

/**
 * Each visible field name is tied to its control (#663 review), so a screen
 * reader says which field the user is in. `getByLabelText` only finds a
 * control through that association, not by nearby text.
 */

afterEach(() => {
  cleanup();
});

function renderPrompt() {
  render(
    <RequiredFieldsDialog
      targetType="Active"
      changing="state"
      requiredFields={[
        { referenceName: 'Custom.ApprovedDate', name: 'Approved Date', type: 'dateTime' },
        { referenceName: 'Custom.Reason', name: 'Reason', type: 'string' },
        {
          referenceName: 'Custom.Impact',
          name: 'Impact',
          type: 'string',
          allowedValues: ['High', 'Low'],
        },
        {
          referenceName: 'Custom.ApprovedBy',
          name: 'Approved By',
          type: 'string',
          isIdentity: true,
        },
      ]}
      fieldValues={{}}
      onFieldChange={() => {}}
      onConfirm={async () => {}}
      onCancel={() => {}}
      isUpdating={false}
      members={[{ id: 'u1', displayName: 'Alex Morgan', email: 'alex@example.com' } as never]}
      memberSearch=""
      onMemberSearchChange={() => {}}
      filteredMembers={[]}
    />
  );
}

describe('RequiredFieldsDialog labels', () => {
  it('names every control by its field', () => {
    renderPrompt();

    expect(screen.getByLabelText('Approved Date *')).toHaveProperty('type', 'date');
    expect(screen.getByLabelText('Reason *')).toHaveProperty('type', 'text');
    expect(screen.getByLabelText('Impact *').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Approved By *')).toHaveProperty('placeholder', 'Search users...');
  });
});
