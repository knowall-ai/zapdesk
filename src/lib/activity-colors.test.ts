import { describe, it, expect } from 'vitest';
import {
  HIGHLIGHT_COLORS,
  PR_ACTIVITY_COLORS,
  RECENT_HIGHLIGHT_COLOR,
  RECENT_HIGHLIGHT_TEXT_COLOR,
  highlightRingColor,
} from './activity-colors';

describe('activity colours (#482)', () => {
  it('gives each pull request activity its own colour', () => {
    const colors = Object.values(PR_ACTIVITY_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('rings a card purple when a pull request is among its reasons', () => {
    expect(highlightRingColor(['updated', 'pr'])).toBe(PR_ACTIVITY_COLORS.merged);
    expect(highlightRingColor(['created'])).toBe('var(--color-brand)');
  });

  it('puts the PR badge on the darker purple, readable under white text', () => {
    expect(HIGHLIGHT_COLORS.pr).toBe('var(--pr-badge)');
  });
});

describe('the 72-hour highlight (#586)', () => {
  it('is amber, from a token, with dark ink on its badge', () => {
    expect(RECENT_HIGHLIGHT_COLOR).toBe('var(--highlight-recent)');
    expect(RECENT_HIGHLIGHT_TEXT_COLOR).toBe('var(--highlight-recent-foreground)');
  });

  it('is not the colour of either 24-hour ring', () => {
    expect(RECENT_HIGHLIGHT_COLOR).not.toBe(highlightRingColor(['updated']));
    expect(RECENT_HIGHLIGHT_COLOR).not.toBe(highlightRingColor(['pr']));
  });
});
