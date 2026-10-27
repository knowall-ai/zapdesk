/**
 * KnowAll brand colours as hex, for the few places that cannot read the CSS
 * custom properties in `src/app/globals.css`: outbound email HTML and `<meta>`
 * tags. Everything rendered in the app uses the tokens instead
 * (`bg-brand`, `text-brand-foreground`, `var(--color-brand)`).
 *
 * These mirror the `@theme` values; `brand-tokens.test.ts` fails if they drift.
 */
export const BRAND_COLORS = {
  /** --color-brand: the KnowAll luminous green */
  brand: '#9dff0a',
  /** --color-brand-hover: hover goes lighter */
  brandHover: '#b4ff3d',
  /** --color-brand-foreground (Tailwind gray-950): ink on brand fills, never white */
  brandForeground: '#030712',
  /** --color-brand-on-light: brand text on a white surface */
  brandOnLight: '#4d7c0f',
  /** --color-success: semantic status green, not the brand */
  success: '#22c55e',
} as const;
