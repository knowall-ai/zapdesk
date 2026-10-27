import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SOURCE_COLORS, SOURCE_LABELS, sourceAccentStyle, sourceKindOf } from './source-colors';
import { isGitHubItem } from './github-kanban';
import { typeColors } from '@/components/standup/StandupKanbanCard';

/**
 * The source colours on the combined boards (#465). The point of the module is
 * that two card components and a legend cannot disagree about which colour
 * means which product, so the tests are mostly about that agreement.
 */

describe('sourceKindOf', () => {
  it('calls a GitHub issue GitHub', () => {
    expect(sourceKindOf({ source: 'github' })).toBe('github');
  });

  it('calls everything else DevOps, including an item with no source at all', () => {
    // DevOps work items arrive without a `source` field; only GitHub sets one.
    expect(sourceKindOf({})).toBe('devops');
    expect(sourceKindOf({ source: 'devops' })).toBe('devops');
  });

  // If these two ever disagree, a card would be dragged as a DevOps item while
  // wearing GitHub's colour, or the reverse.
  it('agrees with isGitHubItem on every shape', () => {
    for (const item of [{}, { source: 'github' }, { source: 'devops' }, { source: 'GitHub' }]) {
      expect(sourceKindOf(item) === 'github').toBe(isGitHubItem(item));
    }
  });
});

describe('the colours themselves', () => {
  it('gives the two sources different colours', () => {
    expect(SOURCE_COLORS.devops).not.toBe(SOURCE_COLORS.github);
  });

  it('names both sources, so a swatch is never shown without its meaning', () => {
    expect(SOURCE_LABELS.devops).toBe('Azure DevOps');
    expect(SOURCE_LABELS.github).toBe('GitHub');
  });

  // The bar is only unambiguous because it is the left edge and nothing else
  // on a card uses that position.
  it('draws the accent as a left border, not a background or a ring', () => {
    const style = sourceAccentStyle({ source: 'github' });
    expect(style.borderLeft).toBe(`3px solid ${SOURCE_COLORS.github}`);
    expect(Object.keys(style)).toEqual(['borderLeft']);
  });

  it('defines every colour variable it refers to in globals.css', () => {
    // A var that resolves to nothing renders no bar at all, and nothing in the
    // type system catches a typo inside the string.
    const css = readFileSync('src/app/globals.css', 'utf8');
    for (const value of Object.values(SOURCE_COLORS)) {
      const name = value.replace(/^var\(/, '').replace(/\)$/, '');
      expect(name).toMatch(/^--/);
      expect(css).toContain(`${name}:`);
    }
  });
});

/**
 * The colours are only useful if they cannot be mistaken for the other colours
 * a card already wears: the work item type badge, the priority dot, the pull
 * request counts and the highlight ring.
 *
 * Brand colours were the intuitive choice and measurably the worst — GitHub's
 * purple sat 12.8 from --pr-merged and Azure's blue 15.4 from --pr-created,
 * because this board already spends purple on Enhancement and blue-cyan on
 * Question. These assertions keep the chosen pair from drifting back there.
 */
describe('the accents stay distinguishable from everything else on a card', () => {
  // CIE76, which is crude but needs no dependency and is more than good enough
  // to tell "clearly a different colour" from "nearly the same colour".
  const toLab = (hex: string): [number, number, number] => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const lin = (v: number) => {
      const c = v / 255;
      return (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92) * 100;
    };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 95.047);
    const y = f((R * 0.2126 + G * 0.7152 + B * 0.0722) / 100);
    const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 108.883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const distance = (a: string, b: string) => {
    const [l1, a1, b1] = toLab(a);
    const [l2, a2, b2] = toLab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  };

  const css = readFileSync('src/app/globals.css', 'utf8');
  const cssVar = (name: string) => {
    const match = css.match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})'));
    if (!match) throw new Error(`${name} is not defined in globals.css`);
    return match[1];
  };
  const resolved = (kind: 'devops' | 'github') =>
    cssVar(SOURCE_COLORS[kind].replace(/^var\(|\)$/g, ''));

  // Every other colour that can appear on one of these cards. The type badge
  // colours come from the card itself, and the rest from the stylesheet, so
  // moving one of them next to an accent fails here rather than shipping.
  const ALSO_ON_A_CARD: Record<string, string> = {
    ...Object.fromEntries(Object.entries(typeColors).map(([type, hex]) => [`type ${type}`, hex])),
    'priority urgent': cssVar('--priority-urgent'),
    'priority high': cssVar('--priority-high'),
    'priority normal': cssVar('--priority-normal'),
    'priority low': cssVar('--priority-low'),
    'pr-created': cssVar('--pr-created'),
    'pr-updated': cssVar('--pr-updated'),
    'pr-merged': cssVar('--pr-merged'),
    'pr-badge': cssVar('--pr-badge'),
    'highlight ring': cssVar('--color-brand'),
    'card surface': cssVar('--surface'),
    'body text': cssVar('--foreground'),
  };

  it.each(['devops', 'github'] as const)(
    'keeps the %s accent clear of every other colour on a card',
    (kind) => {
      const colour = resolved(kind);
      for (const [name, other] of Object.entries(ALSO_ON_A_CARD)) {
        expect(
          distance(colour, other),
          `the ${kind} accent ${colour} is too close to ${name} (${other})`
        ).toBeGreaterThan(25);
      }
    }
  );

  it('keeps the two accents far apart from each other', () => {
    // This is the comparison the reader actually makes, one card against the
    // next, so it gets the strictest bound.
    expect(distance(resolved('devops'), resolved('github'))).toBeGreaterThan(60);
  });
});
