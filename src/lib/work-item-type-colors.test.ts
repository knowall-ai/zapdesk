import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TYPE_BADGE_TINT,
  UNKNOWN_TYPE_HUE,
  UNKNOWN_TYPE_TEXT,
  WORK_ITEM_TYPE_HUES,
  WORK_ITEM_TYPE_TEXT,
  workItemTypeBadgeStyle,
} from './work-item-type-colors';

/**
 * The type badge has to be readable (#575). The badge draws its text over a
 * tint of the type's hue, so the background the text is measured against is
 * not a colour anybody wrote down -- it is the tint composited over the card.
 * These tests do that compositing and then measure, which is the only way the
 * number means anything.
 */

const parse = (hex: string): [number, number, number] => {
  expect(hex, `${hex} is not a six digit hex colour`).toMatch(/^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
};

/** Relative luminance, WCAG 2.1 definition. */
const luminance = (hex: string): number => {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast ratio between two opaque colours, 1:1 to 21:1. */
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** `foreground` at `alpha` over `background`, as the browser composites it. */
const composite = (foreground: string, background: string, alpha: number): string => {
  const [fr, fg, fb] = parse(foreground);
  const [br, bg, bb] = parse(background);
  const mix = (f: number, b: number) =>
    Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(fr, br)}${mix(fg, bg)}${mix(fb, bb)}`;
};

const css = readFileSync('src/app/globals.css', 'utf8');
const cssVar = (name: string): string => {
  const line = css.split('\n').find((l) => l.trimStart().startsWith(`${name}:`));
  const hex = line?.match(/#[0-9a-fA-F]{6}/)?.[0];
  if (!hex) throw new Error(`${name} is not defined in globals.css as a hex colour`);
  return hex;
};

/** The card backgrounds a badge is drawn on: at rest, and under the pointer. */
const CARD_BACKGROUNDS = {
  '--surface': cssVar('--surface'),
  '--surface-hover': cssVar('--surface-hover'),
};

/** WCAG AA for small text. The badge text is 10px, so AA large does not apply. */
const AA_SMALL_TEXT = 4.5;

const TINT_ALPHA = parseInt(TYPE_BADGE_TINT, 16) / 255;

const EVERY_BADGE: Array<[string, string, string]> = [
  ...Object.keys(WORK_ITEM_TYPE_HUES).map(
    (type) =>
      [type, WORK_ITEM_TYPE_HUES[type], WORK_ITEM_TYPE_TEXT[type]] as [string, string, string]
  ),
  ['an unknown type', UNKNOWN_TYPE_HUE, UNKNOWN_TYPE_TEXT],
];

describe('the type badge clears WCAG AA on a dark card', () => {
  it.each(EVERY_BADGE)('%s is readable on both card backgrounds', (type, hue, text) => {
    for (const [name, background] of Object.entries(CARD_BACKGROUNDS)) {
      const badge = composite(hue, background, TINT_ALPHA);
      expect(
        contrast(text, badge),
        `${type}: ${text} on ${badge} (the ${hue} tint over ${name}) is below AA`
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  // The regression this is really guarding: the raw DevOps hue as text, which
  // is what the badge did before. If someone "simplifies" the two maps back
  // into one, these are the numbers that come back.
  it('is why the DevOps hue cannot be the text colour', () => {
    const failing = Object.entries(WORK_ITEM_TYPE_HUES).filter(
      ([, hue]) =>
        contrast(hue, composite(hue, CARD_BACKGROUNDS['--surface'], TINT_ALPHA)) < AA_SMALL_TEXT
    );
    expect(failing.map(([type]) => type)).toEqual(['Bug', 'Enhancement', 'Question', 'Issue']);
  });
});

describe('the two maps stay in step', () => {
  it('gives every type both a hue and a text colour', () => {
    expect(Object.keys(WORK_ITEM_TYPE_TEXT).sort()).toEqual(
      Object.keys(WORK_ITEM_TYPE_HUES).sort()
    );
  });

  it('lifts the text rather than recolouring it, so a type keeps its hue', () => {
    for (const [type, hue] of Object.entries(WORK_ITEM_TYPE_HUES)) {
      const text = WORK_ITEM_TYPE_TEXT[type];
      expect(
        luminance(text),
        `${type} text should be no darker than its hue`
      ).toBeGreaterThanOrEqual(luminance(hue));
    }
  });
});

describe('workItemTypeBadgeStyle', () => {
  it('tints the background with the hue and writes in the text colour', () => {
    expect(workItemTypeBadgeStyle('Enhancement')).toEqual({
      backgroundColor: `${WORK_ITEM_TYPE_HUES.Enhancement}${TYPE_BADGE_TINT}`,
      color: WORK_ITEM_TYPE_TEXT.Enhancement,
    });
  });

  // The bug this replaces: the card fell back to `var(--text-muted)` and then
  // appended the alpha to it, so an unknown type's background was the string
  // `var(--text-muted)20`, which is not a colour and painted nothing.
  it.each([undefined, '', 'Impediment', 'Shared Steps'])(
    'still produces a real colour for %p',
    (type) => {
      const style = workItemTypeBadgeStyle(type);
      expect(style.backgroundColor).toBe(`${UNKNOWN_TYPE_HUE}${TYPE_BADGE_TINT}`);
      expect(style.color).toBe(UNKNOWN_TYPE_TEXT);
      expect(style.backgroundColor).not.toContain('var(');
      expect(style.color).not.toContain('var(');
    }
  );

  it('accepts an eight digit hex background, which is what the alpha suffix makes', () => {
    for (const type of [...Object.keys(WORK_ITEM_TYPE_HUES), 'Impediment']) {
      expect(workItemTypeBadgeStyle(type).backgroundColor).toMatch(/^#[0-9a-f]{8}$/i);
    }
  });
});
