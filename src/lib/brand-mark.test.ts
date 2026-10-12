import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The lightning bolt exists as three separate literals: the generator's
 * `BOLT_POINTS_64`, the polygon `ZapDeskIcon` renders, and the polygon baked
 * into each generated SVG. Nothing in the language ties them together.
 *
 * They drifted once already. The committed logos moved to the bolt while the
 * generator still drew an older "D", so running it replaced the brand mark
 * across every asset — including the one outbound email embeds — and exited
 * successfully while doing it (#361).
 *
 * This is the guard. It compares the marks as data rather than trusting a
 * comment to keep maintainers in step.
 */

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

/** First `points="..."` in an SVG or TSX source, normalised for comparison. */
function polygonPoints(source: string, file: string): string {
  const match = source.match(/points="([^"]+)"/);
  if (!match) throw new Error(`no polygon points found in ${file}`);
  return match[1].trim().replace(/\s+/g, ' ');
}

/** The generator's `BOLT_POINTS_64`, read as data rather than executed. */
function generatorPoints(): string {
  const source = read('scripts', 'generate-logo.js');
  const block = source.match(/const BOLT_POINTS_64 = \[([\s\S]*?)\];/);
  if (!block) throw new Error('BOLT_POINTS_64 not found in scripts/generate-logo.js');
  const pairs = [...block[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)];
  if (pairs.length === 0) throw new Error('BOLT_POINTS_64 has no coordinate pairs');
  return pairs.map((p) => `${p[1]},${p[2]}`).join(' ');
}

describe('the ZapDesk bolt is the same mark everywhere', () => {
  const generator = generatorPoints();

  it('matches the polygon the app renders', () => {
    const icon = polygonPoints(
      read('src', 'components', 'common', 'ZapDeskIcon.tsx'),
      'ZapDeskIcon.tsx'
    );
    expect(icon).toBe(generator);
  });

  it.each([
    ['public/assets/icon.svg', ['public', 'assets', 'icon.svg']],
    ['src/app/icon.svg', ['src', 'app', 'icon.svg']],
    ['src/app/apple-icon.svg', ['src', 'app', 'apple-icon.svg']],
  ])('matches the committed %s', (name, path) => {
    expect(polygonPoints(read(...path), name)).toBe(generator);
  });

  // The "D" is what the generator used to draw. If it reappears in a committed
  // asset, the generator has been run from an older revision.
  it.each([
    ['public/assets/icon.svg', ['public', 'assets', 'icon.svg']],
    ['public/assets/logo.svg', ['public', 'assets', 'logo.svg']],
    ['public/assets/logo-light.svg', ['public', 'assets', 'logo-light.svg']],
    ['src/app/icon.svg', ['src', 'app', 'icon.svg']],
    ['src/app/apple-icon.svg', ['src', 'app', 'apple-icon.svg']],
  ])('%s carries a bolt, not the old "D"', (name, path) => {
    const svg = read(...path);
    expect(svg, name).toContain('<polygon');
    // The "D" was drawn as a path with an arc; the bolt is a plain polygon.
    expect(svg, name).not.toMatch(/<path[^>]*\bd="[^"]*[Aa]\s/);
  });
});
