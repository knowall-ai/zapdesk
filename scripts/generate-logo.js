#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * ZapDesk Logo Generator
 *
 * Generates the ZapDesk logo assets with a lightning bolt zap icon
 * for a modern, energetic aesthetic.
 *
 * Usage: node scripts/generate-logo.js
 *
 * The lightning bolt is the brand mark. Every asset this script writes takes
 * its geometry from the single `BOLT_POINTS_64` definition below, scaled to
 * size, so the generated files cannot disagree with each other.
 *
 * That definition is still a separate literal from the polygon the app renders
 * in `components/common/ZapDeskIcon.tsx`: nothing in the language keeps them
 * in step, and editing one without the other will drift. `src/lib/brand-mark.test.ts`
 * compares them, and the committed assets, on every run.
 *
 * This script previously drew an older stylized "D". The committed logos had
 * moved to the bolt but the generator had not, so running it silently
 * replaced the bolt with the "D" across every asset -- including the one
 * outbound email embeds. A warning comment was not enough: the script still
 * exited successfully and wrote the files.
 *
 * Outputs:
 *   - public/assets/icon.svg       - Standalone icon (64x64)
 *   - public/assets/logo.svg       - Full logo for dark backgrounds
 *   - public/assets/logo-light.svg - Full logo for light backgrounds
 *   - src/app/icon.svg             - Next.js App Router icon
 */

const fs = require('fs');
const path = require('path');

// Brand colors
/**
 * The lightning bolt, as points for an SVG `<polygon>`.
 *
 * Coordinates are ZapDeskIcon's 64x64 viewBox, scaled and offset to wherever
 * the caller is drawing. Keeping one definition is the point -- the drift this
 * script suffered came from the mark being written out by hand in three
 * places.
 *
 * @param {number} size Edge length of the square the bolt sits in.
 * @param {number} x Left edge of that square.
 * @param {number} y Top edge of that square.
 * @returns {string} A `points` attribute value.
 */
const BOLT_POINTS_64 = [
  [37, 5],
  [17, 35.5],
  [29.5, 35.5],
  [24.5, 59],
  [47, 28],
  [34.5, 28],
];

function boltPolygon(size, x = 0, y = 0) {
  const k = size / 64;
  return BOLT_POINTS_64.map(([px, py]) => `${round(x + px * k)},${round(y + py * k)}`).join(' ');
}

/** Trim floating-point noise so the generated SVGs stay readable. */
function round(n) {
  return Math.round(n * 100) / 100;
}

const COLORS = {
  primary: '#22c55e', // Main brand green
  primaryLight: '#4ade80', // Lighter green for gradients
  primaryDark: '#16a34a', // Darker green for depth
  white: '#ffffff',
  textLight: '#f3f4f6', // Light theme text
  textDark: '#1f2937', // Dark theme text
  mutedLight: '#9ca3af', // Light theme muted
  mutedDark: '#6b7280', // Dark theme muted
};

/**
 * Generates the stylized "D" icon with arrow cutout
 * The design features:
 * - Bold, geometric "D" shape
 * - Arrow/triangle on left stroke pointing right into the D
 * - Subtle gradient for metallic depth
 * - Works well at small sizes (favicon, sidebar)
 */
function generateIconSVG(size = 64) {
  // Scale factor for the icon paths
  const s = size / 64;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <!-- Gradient for metallic effect -->
    <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.primaryLight}" />
      <stop offset="50%" stop-color="${COLORS.primary}" />
      <stop offset="100%" stop-color="${COLORS.primaryDark}" />
    </linearGradient>
    <!-- Subtle shine for 3D effect -->
    <linearGradient id="shineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.white}" stop-opacity="0.3" />
      <stop offset="50%" stop-color="${COLORS.white}" stop-opacity="0" />
    </linearGradient>
  </defs>

  <!-- Background with rounded corners -->
  <rect x="0" y="0" width="${size}" height="${size}" rx="${8 * s}" ry="${8 * s}" fill="url(#metalGradient)" />

  <!-- Subtle shine overlay -->
  <rect x="0" y="0" width="${size}" height="${size}" rx="${8 * s}" ry="${8 * s}" fill="url(#shineGradient)" />

  <!-- Lightning bolt -->
  <polygon points="${boltPolygon(size)}" fill="${COLORS.white}" />
</svg>`;
}

/**
 * Generates the full logo with icon + text for dark backgrounds
 */
function generateFullLogoDark(width = 400, height = 100) {
  const iconSize = 60;
  const iconY = (height - iconSize) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="metalGradientFull" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.primaryLight}" />
      <stop offset="50%" stop-color="${COLORS.primary}" />
      <stop offset="100%" stop-color="${COLORS.primaryDark}" />
    </linearGradient>
    <linearGradient id="shineGradientFull" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.white}" stop-opacity="0.3" />
      <stop offset="50%" stop-color="${COLORS.white}" stop-opacity="0" />
    </linearGradient>
  </defs>

  <!-- Icon background -->
  <rect x="10" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="8" ry="8" fill="url(#metalGradientFull)" />
  <rect x="10" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="8" ry="8" fill="url(#shineGradientFull)" />

  <!-- Lightning bolt (scaled for 60x60 icon) -->
  <polygon
    points="${boltPolygon(iconSize, 10, iconY)}"
    fill="${COLORS.white}"
  />

  <!-- "ZapDesk" wordmark, single brand green -->
  <text x="85" y="55" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="36" font-weight="700">
    <tspan fill="${COLORS.primary}">ZapDesk</tspan>
  </text>

  <!-- Tagline -->
  <text x="85" y="78" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12" fill="${COLORS.mutedLight}">Azure DevOps Powered Support Ticketing</text>
</svg>`;
}

/**
 * Generates the full logo with icon + text for light backgrounds
 */
function generateFullLogoLight(width = 400, height = 100) {
  const iconSize = 60;
  const iconY = (height - iconSize) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="metalGradientFullLight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.primary}" />
      <stop offset="100%" stop-color="${COLORS.primaryDark}" />
    </linearGradient>
    <linearGradient id="shineGradientFullLight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.white}" stop-opacity="0.2" />
      <stop offset="50%" stop-color="${COLORS.white}" stop-opacity="0" />
    </linearGradient>
  </defs>

  <!-- Icon background -->
  <rect x="10" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="8" ry="8" fill="url(#metalGradientFullLight)" />
  <rect x="10" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="8" ry="8" fill="url(#shineGradientFullLight)" />

  <!-- Lightning bolt (scaled for 60x60 icon) -->
  <polygon
    points="${boltPolygon(iconSize, 10, iconY)}"
    fill="${COLORS.white}"
  />

  <!-- "ZapDesk" wordmark, single brand green -->
  <text x="85" y="55" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="36" font-weight="700">
    <tspan fill="${COLORS.primary}">ZapDesk</tspan>
  </text>

  <!-- Tagline -->
  <text x="85" y="78" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12" fill="${COLORS.mutedDark}">Azure DevOps Powered Support Ticketing</text>
</svg>`;
}

/**
 * Main function to generate all logo assets
 */
function main() {
  const rootDir = path.resolve(__dirname, '..');

  // Ensure directories exist
  const assetsDir = path.join(rootDir, 'public', 'assets');
  const appDir = path.join(rootDir, 'src', 'app');

  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // Generate and save icons
  const icon64 = generateIconSVG(64);
  const fullLogoDark = generateFullLogoDark();
  const fullLogoLight = generateFullLogoLight();

  // Write icon SVG (standalone icon for general use)
  fs.writeFileSync(path.join(assetsDir, 'icon.svg'), icon64);
  console.log('Generated: public/assets/icon.svg');

  // Write full logos
  fs.writeFileSync(path.join(assetsDir, 'logo.svg'), fullLogoDark);
  console.log('Generated: public/assets/logo.svg');

  fs.writeFileSync(path.join(assetsDir, 'logo-light.svg'), fullLogoLight);
  console.log('Generated: public/assets/logo-light.svg');

  // Write icon to app directory for Next.js favicon
  fs.writeFileSync(path.join(appDir, 'icon.svg'), icon64);
  console.log('Generated: src/app/icon.svg');

  // Write apple touch icon
  fs.writeFileSync(path.join(appDir, 'apple-icon.svg'), icon64);
  console.log('Generated: src/app/apple-icon.svg');

  console.log('\nAll logo assets generated successfully!');
  console.log('\nDesign features:');
  console.log('  - Lightning bolt, matching ZapDeskIcon in the app');
  console.log('  - Rounded square tile behind the mark');
  console.log('  - Metallic gradient for modern depth');
  console.log('  - Brand green (#22c55e) maintained');
}

main();
