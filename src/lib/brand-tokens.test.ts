import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BRAND_COLORS } from './brand';

/**
 * ZapDesk uses the KnowAll luminous green (#9dff0a), with token names shared
 * with the website, Sallie and Timmie. The tokens live in one place, the
 * `@theme static` block in globals.css; components reach them through
 * `bg-brand` / `var(--color-brand)` and never repeat the hex.
 */

const root = join(__dirname, '..', '..');
const globalsCss = readFileSync(join(root, 'src', 'app', 'globals.css'), 'utf8');

/** Value of a custom property declared in the `@theme static` block. */
function themeToken(name: string): string {
  const block = globalsCss.match(/@theme static\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error('@theme static block not found in globals.css');
  const decl = block[1].match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!decl) throw new Error(`${name} not declared in @theme static`);
  return decl[1].trim();
}

describe('brand tokens', () => {
  it('is the KnowAll luminous green, with a lighter hover', () => {
    expect(themeToken('--color-brand')).toBe('#9dff0a');
    expect(themeToken('--color-brand-hover')).toBe('#b4ff3d');
    expect(themeToken('--color-brand-on-light')).toBe('#4d7c0f');
  });

  it('puts dark ink, never white, on brand fills', () => {
    expect(themeToken('--color-brand-foreground')).toBe('var(--color-gray-950)');
  });

  it('aliases the shadcn primary and ring tokens to the brand', () => {
    expect(themeToken('--color-primary')).toBe('var(--color-brand)');
    expect(themeToken('--color-primary-foreground')).toBe('var(--color-brand-foreground)');
    expect(themeToken('--color-ring')).toBe('var(--color-brand)');
  });

  it('keeps the status green separate from the brand', () => {
    expect(themeToken('--color-success')).toBe('#22c55e');
  });

  it('mirrors the theme in src/lib/brand.ts', () => {
    expect(BRAND_COLORS.brand).toBe(themeToken('--color-brand'));
    expect(BRAND_COLORS.brandHover).toBe(themeToken('--color-brand-hover'));
    expect(BRAND_COLORS.brandOnLight).toBe(themeToken('--color-brand-on-light'));
    expect(BRAND_COLORS.success).toBe(themeToken('--color-success'));
  });

  it('mirrors the theme in the logo generator', () => {
    const generator = readFileSync(join(root, 'scripts', 'generate-logo.js'), 'utf8');
    expect(generator).toContain(`brand: '${BRAND_COLORS.brand}'`);
    expect(generator).toContain(`brandOnLight: '${BRAND_COLORS.brandOnLight}'`);
  });
});

describe('no raw brand colour outside the theme', () => {
  // The theme itself, its hex mirror for email/meta, and this test.
  const allowed = new Set(
    ['src/app/globals.css', 'src/lib/brand.ts', 'src/lib/brand-tokens.test.ts'].map((p) =>
      p.split('/').join(sep)
    )
  );

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|css)$/.test(name) ? [path] : [];
    });
  }

  const files = sourceFiles(join(root, 'src')).filter((f) => !allowed.has(relative(root, f)));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each([
    ['#9dff0a', /#9dff0a/i],
    ['#22c55e', /#22c55e/i],
    ['rgba(34, 197, 94, …)', /rgba\(\s*34\s*,\s*197\s*,\s*94/],
    ['the retired var(--primary)', /var\(--primary(-[a-z]+)?\)/],
  ])('no file uses %s', (_label, pattern) => {
    const offenders = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});
