// One-off generator for branded email logos.
// Run with: bun run scripts/generate-email-assets.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

mkdirSync('public/email', { recursive: true });

const svg = readFileSync('public/assets/logo.svg');
await sharp(svg, { density: 300 })
  .resize({ width: 480, height: 120, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('public/email/zapdesk-logo.png');
console.log('wrote public/email/zapdesk-logo.png (480x120, transparent)');

// Minimal transparent placeholder so the path resolves in dev. Replace
// before merge with the real KnowAll AI logo (PNG, transparent, ~480x120).
await sharp({
  create: {
    width: 480,
    height: 120,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .png()
  .toFile('public/email/knowall-logo.png');
console.log('wrote public/email/knowall-logo.png (480x120 transparent placeholder)');
