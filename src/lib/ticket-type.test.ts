import { describe, it, expect } from 'vitest';
import { keptTicketType } from './ticket-type';

const types = [{ name: 'Bug' }, { name: 'Enhancement' }, { name: 'Question' }];

describe('keptTicketType (#7379)', () => {
  it('starts blank, never Task', () => {
    expect(keptTicketType('', [{ name: 'Task' }, ...types])).toBe('');
  });

  it('keeps a type the new project also has', () => {
    expect(keptTicketType('Bug', types)).toBe('Bug');
  });

  it('clears a type the new project lacks', () => {
    expect(keptTicketType('Issue', types)).toBe('');
  });
});
