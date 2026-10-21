import { describe, it, expect } from 'vitest';
import { HIGHLIGHT_COLORS, PR_ACTIVITY_COLORS, highlightRingColor } from './activity-colors';

describe('activity colours (#482)', () => {
  it('gives each pull request activity its own colour', () => {
    const colors = Object.values(PR_ACTIVITY_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('rings a card purple when a pull request is among its reasons', () => {
    expect(highlightRingColor(['updated', 'pr'])).toBe(HIGHLIGHT_COLORS.pr);
    expect(highlightRingColor(['created'])).toBe('var(--primary)');
  });

  it('marks a pull request link the same colour as a merge', () => {
    expect(HIGHLIGHT_COLORS.pr).toBe(PR_ACTIVITY_COLORS.merged);
  });
});
