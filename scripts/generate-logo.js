#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * DevDesk Logo Generator
 *
 * Generates the DevDesk logo assets with a stylized "D" featuring
 * a directional arrow cutout for a modern, forward-moving aesthetic.
 *
 * Usage: node scripts/generate-logo.js
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

  <!-- Stylized "D" with arrow cutout on left stroke -->
  <!-- The D is constructed as a path with:
       - Left vertical stroke with arrow pointing right
       - Curved right side forming the bowl
  -->
  <path
    d="M ${14 * s} ${12 * s}
       L ${14 * s} ${26 * s}
       L ${22 * s} ${32 * s}
       L ${14 * s} ${38 * s}
       L ${14 * s} ${52 * s}
       L ${28 * s} ${52 * s}
       C ${48 * s} ${52 * s} ${54 * s} ${42 * s} ${54 * s} ${32 * s}
       C ${54 * s} ${22 * s} ${48 * s} ${12 * s} ${28 * s} ${12 * s}
       Z

       M ${24 * s} ${20 * s}
       L ${28 * s} ${20 * s}
       C ${42 * s} ${20 * s} ${46 * s} ${26 * s} ${46 * s} ${32 * s}
       C ${46 * s} ${38 * s} ${42 * s} ${44 * s} ${28 * s} ${44 * s}
       L ${24 * s} ${44 * s}
       Z"
    fill="${COLORS.white}"
    fill-rule="evenodd"
  />
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

  <!-- Stylized D with arrow cutout on left stroke (scaled for 60x60 icon) -->
  <path
    d="M ${10 + 13.125} ${iconY + 11.25}
       L ${10 + 13.125} ${iconY + 24.375}
       L ${10 + 20.625} ${iconY + 30}
       L ${10 + 13.125} ${iconY + 35.625}
       L ${10 + 13.125} ${iconY + 48.75}
       L ${10 + 26.25} ${iconY + 48.75}
       C ${10 + 45} ${iconY + 48.75} ${10 + 50.625} ${iconY + 39.375} ${10 + 50.625} ${iconY + 30}
       C ${10 + 50.625} ${iconY + 20.625} ${10 + 45} ${iconY + 11.25} ${10 + 26.25} ${iconY + 11.25}
       Z

       M ${10 + 22.5} ${iconY + 18.75}
       L ${10 + 26.25} ${iconY + 18.75}
       C ${10 + 39.375} ${iconY + 18.75} ${10 + 43.125} ${iconY + 24.375} ${10 + 43.125} ${iconY + 30}
       C ${10 + 43.125} ${iconY + 35.625} ${10 + 39.375} ${iconY + 41.25} ${10 + 26.25} ${iconY + 41.25}
       L ${10 + 22.5} ${iconY + 41.25}
       Z"
    fill="${COLORS.white}"
    fill-rule="evenodd"
  />

  <!-- "Dev" text in green -->
  <text x="85" y="55" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="36" font-weight="700" fill="${COLORS.primary}">Dev</text>

  <!-- "Desk" text in light gray -->
  <text x="168" y="55" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="36" font-weight="700" fill="${COLORS.textLight}">Desk</text>

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

  <!-- Stylized D with arrow cutout on left stroke (scaled for 60x60 icon) -->
  <path
    d="M ${10 + 13.125} ${iconY + 11.25}
       L ${10 + 13.125} ${iconY + 24.375}
       L ${10 + 20.625} ${iconY + 30}
       L ${10 + 13.125} ${iconY + 35.625}
       L ${10 + 13.125} ${iconY + 48.75}
       L ${10 + 26.25} ${iconY + 48.75}
       C ${10 + 45} ${iconY + 48.75} ${10 + 50.625} ${iconY + 39.375} ${10 + 50.625} ${iconY + 30}
       C ${10 + 50.625} ${iconY + 20.625} ${10 + 45} ${iconY + 11.25} ${10 + 26.25} ${iconY + 11.25}
       Z

       M ${10 + 22.5} ${iconY + 18.75}
       L ${10 + 26.25} ${iconY + 18.75}
       C ${10 + 39.375} ${iconY + 18.75} ${10 + 43.125} ${iconY + 24.375} ${10 + 43.125} ${iconY + 30}
       C ${10 + 43.125} ${iconY + 35.625} ${10 + 39.375} ${iconY + 41.25} ${10 + 26.25} ${iconY + 41.25}
       L ${10 + 22.5} ${iconY + 41.25}
       Z"
    fill="${COLORS.white}"
    fill-rule="evenodd"
  />

  <!-- "Dev" text in green -->
  <text x="85" y="55" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="36" font-weight="700" fill="${COLORS.primary}">Dev</text>

  <!-- "Desk" text in dark gray -->
  <text x="168" y="55" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="36" font-weight="700" fill="${COLORS.textDark}">Desk</text>

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

  console.log('\nAll logo assets generated successfully!');
  console.log('\nDesign features:');
  console.log('  - Stylized "D" with bold geometric form');
  console.log('  - Arrow cutout on left stroke pointing into the D');
  console.log('  - Metallic gradient for modern depth');
  console.log('  - Brand green (#22c55e) maintained');
}

main();
