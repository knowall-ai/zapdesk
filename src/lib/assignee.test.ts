import { describe, it, expect } from 'vitest';
import { assigneeIdentity } from './assignee';

describe('assigneeIdentity', () => {
  // A bare address is only unique when one identity carries it. After a
  // directory migration an org can hold two, and DevOps then rejects the PATCH
  // outright with WorkItemFieldInvalidException (#399).
  it('qualifies the address with the display name', () => {
    expect(
      assigneeIdentity({ id: 'guid-1', displayName: 'Jane Doe', email: 'jane.doe@example.com' })
    ).toBe('Jane Doe <jane.doe@example.com>');
  });

  it('trims stray whitespace rather than embedding it in the name', () => {
    expect(
      assigneeIdentity({ id: 'guid-1', displayName: ' Jane Doe ', email: ' jane.doe@example.com ' })
    ).toBe('Jane Doe <jane.doe@example.com>');
  });

  it('falls back to the address when there is no display name', () => {
    expect(assigneeIdentity({ id: 'guid-1', displayName: '', email: 'jane.doe@example.com' })).toBe(
      'jane.doe@example.com'
    );
  });

  it('falls back to the id when there is no address', () => {
    expect(assigneeIdentity({ id: 'guid-1', displayName: 'Jane Doe', email: '' })).toBe('guid-1');
  });

  it('handles a display name containing punctuation', () => {
    expect(
      assigneeIdentity({ id: 'guid-2', displayName: "Ciara O'Neill", email: 'ciara@example.com' })
    ).toBe("Ciara O'Neill <ciara@example.com>");
  });
});
