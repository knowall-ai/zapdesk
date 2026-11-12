import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_TEXT_COLORS,
  PR_ACTIVITY_COLORS,
  RECENT_HIGHLIGHT_COLOR,
  RECENT_HIGHLIGHT_TEXT_COLOR,
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
  /**
   * Where the tokens are declared: ours, then Tailwind's own theme, which is
   * where `--color-brand-foreground`'s gray-950 lives (written in oklch).
   * Reading both means the test measures whatever the tokens really are, so
   * changing one to an unreadable colour fails here.
   */
  const sheets = [
    readFileSync('src/app/globals.css', 'utf8'),
    readFileSync('node_modules/tailwindcss/theme.css', 'utf8'),
  ];
  const declared = (name: string): string => {
    const pattern = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm');
    for (const sheet of sheets) {
      const value = sheet.match(pattern)?.[1].trim();
      if (value) return value;
    }
    throw new Error(`${name} is not declared in globals.css or Tailwind's theme`);
  };

  /** sRGB channel (0-1) to linear light, WCAG 2.1. */
  const linearise = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

  /** Linear-light RGB of a CSS colour value, following `var()` to its token. */
  const linearRgb = (value: string): [number, number, number] => {
    const token = value.match(/^var\((--[\w-]+)\)$/)?.[1];
    if (token) return linearRgb(declared(token));
    if (value === 'white') return [1, 1, 1];

    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (hex) {
      const full = hex.length === 3 ? [...hex].map((h) => h + h).join('') : hex;
      return [0, 2, 4].map((i) => linearise(parseInt(full.slice(i, i + 2), 16) / 255)) as [
        number,
        number,
        number,
      ];
    }

    // oklch(L% C H) -> OKLab -> linear sRGB (Björn Ottosson's matrices).
    const oklch = value.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/);
    if (oklch) {
      const L = Number(oklch[1]) / 100;
      const C = Number(oklch[2]);
      const h = (Number(oklch[3]) * Math.PI) / 180;
      const a = C * Math.cos(h);
      const b = C * Math.sin(h);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      return [
        clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
      ];
    }
    throw new Error(`cannot resolve colour ${value}`);
  };

  /** Relative luminance, WCAG 2.1 definition. */
  const luminance = (value: string): number => {
    const [r, g, b] = linearRgb(value);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  /** Contrast ratio between two opaque colours, 1:1 to 21:1. */
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** WCAG AA for small text: the badge text is 10px. */
  const AA_SMALL_TEXT = 4.5;

  const reasons = Object.keys(HIGHLIGHT_COLORS) as HighlightReason[];

  it.each(reasons)('%s badge text is readable on its fill', (reason) => {
    const { backgroundColor, color } = highlightBadgeStyle(reason);
    const ratio = contrast(backgroundColor, color);
    expect(
      ratio,
      `${reason}: ${color} on ${backgroundColor} is ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it('converts oklch correctly: Tailwind gray-950 matches its published sRGB hex', () => {
    // A check on the converter above, not on the theme: #030712 is the hex
    // Tailwind documents for gray-950's oklch value.
    expect(luminance('oklch(13% 0.028 261.692)')).toBeCloseTo(luminance('#030712'), 3);
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
