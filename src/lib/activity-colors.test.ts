import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_TEXT_COLORS,
  PR_ACTIVITY_COLORS,
  highlightBadgeStyle,
  highlightRingColor,
} from './activity-colors';
import type { HighlightReason } from './activity-summary';

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

/**
 * The reason badges have to be readable (#587). Their fills are solid, so the
 * text is measured straight against the fill -- there is no tint to composite.
 */
describe('highlight reason badges clear WCAG AA (#587)', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const cssHex = (name: string): string => {
    const line = css.split('\n').find((l) => l.trimStart().startsWith(`${name}:`));
    const hex = line?.match(/#[0-9a-fA-F]{6}/)?.[0];
    if (!hex) throw new Error(`${name} is not defined in globals.css as a hex colour`);
    return hex;
  };

  /**
   * What each token resolves to on the dark theme. `--color-brand-foreground`
   * is Tailwind's gray-950, which Tailwind 4 writes in oklch; #030712 is its
   * sRGB hex.
   */
  const RESOLVED: Record<string, string> = {
    'var(--color-brand)': cssHex('--color-brand'),
    'var(--pr-badge)': cssHex('--pr-badge'),
    'var(--color-brand-foreground)': '#030712',
    white: '#ffffff',
  };

  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** WCAG AA for small text: the badge text is 10px. */
  const AA_SMALL_TEXT = 4.5;

  const reasons = Object.keys(HIGHLIGHT_COLORS) as HighlightReason[];

  it.each(reasons)('%s badge text is readable on its fill', (reason) => {
    const { backgroundColor, color } = highlightBadgeStyle(reason);
    const ratio = contrast(RESOLVED[backgroundColor], RESOLVED[color]);
    expect(
      ratio,
      `${reason}: ${color} on ${backgroundColor} is ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it('never puts white on the brand lime', () => {
    for (const reason of reasons) {
      const { backgroundColor, color } = highlightBadgeStyle(reason);
      if (backgroundColor === 'var(--color-brand)') {
        expect(color).toBe('var(--color-brand-foreground)');
      }
    }
  });

  it('keeps white text on the PR badge', () => {
    expect(HIGHLIGHT_TEXT_COLORS.pr).toBe('white');
  });
});
