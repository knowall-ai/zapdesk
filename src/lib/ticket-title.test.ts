import { describe, it, expect } from 'vitest';
import { MAX_TITLE_LENGTH, titleProblem } from './ticket-title';

/**
 * The rule the ticket screen and the PATCH route both read (7772). It returns
 * words a person can act on, not a boolean, because the screen shows them.
 */
describe('titleProblem', () => {
  it('accepts an ordinary title', () => {
    expect(titleProblem('Printer offline in the Leeds office')).toBeNull();
  });

  it.each(['', '   ', '\t\n'])('refuses %j as empty', (title) => {
    expect(titleProblem(title)).toBe('A title is required.');
  });

  it('accepts a title that only needs trimming', () => {
    // What the person meant is in there, so this is not their problem to fix.
    expect(titleProblem('  Printer offline  ')).toBeNull();
  });

  it('accepts a title at the limit', () => {
    expect(titleProblem('x'.repeat(MAX_TITLE_LENGTH))).toBeNull();
  });

  it('refuses a title one character over the limit', () => {
    expect(titleProblem('x'.repeat(MAX_TITLE_LENGTH + 1))).toBe(
      `A title must be ${MAX_TITLE_LENGTH} characters or fewer.`
    );
  });

  it('measures the limit after trimming, not before', () => {
    // Otherwise padding a title to the limit refuses a title that fits.
    expect(titleProblem(`  ${'x'.repeat(MAX_TITLE_LENGTH)}  `)).toBeNull();
  });
});
