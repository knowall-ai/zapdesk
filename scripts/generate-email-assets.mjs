// One-off generator for branded email logos.
// Run with: bun run scripts/generate-email-assets.mjs
import sharp from 'sharp';
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

mkdirSync('public/email', { recursive: true });

// logo-light.svg, not logo.svg. The two differ only in the "Desk" wordmark and
// tagline: logo.svg draws them near-white (#f3f4f6) for a dark background,
// logo-light.svg near-black (#1f2937) for a light one. The email card is
// #ffffff, so the dark-background variant put near-white text on white and
// "Desk" all but vanished -- the logo read as "Zap" with a grey smudge after it.
const svg = readFileSync('public/assets/logo-light.svg');
await sharp(svg, { density: 300 })
  .resize({ width: 480, height: 120, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('public/email/zapdesk-logo.png');
console.log('wrote public/email/zapdesk-logo.png (480x120, transparent)');

// The KnowAll AI logo is not generated. It is a brand asset that has to be
// supplied, and this script used to write a fully transparent placeholder in
// its place — which looks like a real file to everything downstream while
// rendering as a blank gap in every outbound customer email.
//
// The template treats the logo as opt-in and falls back to a text wordmark, so
// a missing file costs nothing. Say so and stop, rather than manufacturing an
// asset that is worse than none.
const knowallPath = 'public/email/knowall-logo.png';
if (existsSync(knowallPath)) {
  console.log(`found ${knowallPath} — left untouched`);
} else {
  console.log(`no ${knowallPath} — not generating one.`);
  console.log('  The email footer falls back to a "Powered by KnowAll AI" wordmark without it.');
  console.log(
    '  To use the real logo: drop it in at 480x120, or point KNOWALL_LOGO_URL at a hosted copy.'
  );
}
