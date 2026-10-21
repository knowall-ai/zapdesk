import { describe, it, expect } from 'vitest';
import { HIGHLIGHT_COLORS, PR_ACTIVITY_COLORS, highlightRingColor } from './activity-colors';

describe('activity colours (#482)', () => {
  it('gives each pull request activity its own colour', () => {
    const colors = Object.values(PR_ACTIVITY_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('rings a card purple when a pull request is among its reasons', () => {
    expect(highlightRingColor(['updated', 'pr'])).toBe(PR_ACTIVITY_COLORS.merged);
    expect(highlightRingColor(['created'])).toBe('var(--primary)');
  });

  it('puts the PR badge on the darker purple, readable under white text', () => {
    expect(HIGHLIGHT_COLORS.pr).toBe('var(--pr-badge)');
  });
});
