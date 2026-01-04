import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');

// Stylized D icon with arrow cutout - base 64x64 design scaled for each size
// The D has an arrow pointing right cut into the left stroke

// Favicon SVG content (32x32)
const faviconSvg = `<svg width="32" height="32" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ade80" />
      <stop offset="50%" stop-color="#22c55e" />
      <stop offset="100%" stop-color="#16a34a" />
    </linearGradient>
    <linearGradient id="shineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3" />
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#metalGradient)"/>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#shineGradient)"/>
  <path d="M 14 12 L 14 26 L 22 32 L 14 38 L 14 52 L 28 52 C 48 52 54 42 54 32 C 54 22 48 12 28 12 Z M 24 20 L 28 20 C 42 20 46 26 46 32 C 46 38 42 44 28 44 L 24 44 Z" fill="#ffffff" fill-rule="evenodd"/>
</svg>`;

// Apple touch icon SVG content (180x180)
const appleTouchSvg = `<svg width="180" height="180" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ade80" />
      <stop offset="50%" stop-color="#22c55e" />
      <stop offset="100%" stop-color="#16a34a" />
    </linearGradient>
    <linearGradient id="shineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3" />
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#metalGradient)"/>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#shineGradient)"/>
  <path d="M 14 12 L 14 26 L 22 32 L 14 38 L 14 52 L 28 52 C 48 52 54 42 54 32 C 54 22 48 12 28 12 Z M 24 20 L 28 20 C 42 20 46 26 46 32 C 46 38 42 44 28 44 L 24 44 Z" fill="#ffffff" fill-rule="evenodd"/>
</svg>`;

// Icon 192x192 for PWA
const icon192Svg = `<svg width="192" height="192" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ade80" />
      <stop offset="50%" stop-color="#22c55e" />
      <stop offset="100%" stop-color="#16a34a" />
    </linearGradient>
    <linearGradient id="shineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3" />
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#metalGradient)"/>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#shineGradient)"/>
  <path d="M 14 12 L 14 26 L 22 32 L 14 38 L 14 52 L 28 52 C 48 52 54 42 54 32 C 54 22 48 12 28 12 Z M 24 20 L 28 20 C 42 20 46 26 46 32 C 46 38 42 44 28 44 L 24 44 Z" fill="#ffffff" fill-rule="evenodd"/>
</svg>`;

// Icon 512x512 for PWA
const icon512Svg = `<svg width="512" height="512" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ade80" />
      <stop offset="50%" stop-color="#22c55e" />
      <stop offset="100%" stop-color="#16a34a" />
    </linearGradient>
    <linearGradient id="shineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3" />
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#metalGradient)"/>
  <rect x="0" y="0" width="64" height="64" rx="8" fill="url(#shineGradient)"/>
  <path d="M 14 12 L 14 26 L 22 32 L 14 38 L 14 52 L 28 52 C 48 52 54 42 54 32 C 54 22 48 12 28 12 Z M 24 20 L 28 20 C 42 20 46 26 46 32 C 46 38 42 44 28 44 L 24 44 Z" fill="#ffffff" fill-rule="evenodd"/>
</svg>`;

async function generateIcon(svg, outputPath, width, height) {
  try {
    await sharp(Buffer.from(svg)).resize(width, height).png().toFile(outputPath);
    console.log(`Created ${path.basename(outputPath)}`);
  } catch (err) {
    throw new Error(`Failed to generate ${path.basename(outputPath)}: ${err.message}`);
  }
}

async function generateIcons() {
  console.log('Generating icons...');

  // Ensure public directory exists
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    console.log(`Created public directory: ${publicDir}`);
  }

  // Generate favicon PNGs
  await generateIcon(faviconSvg, path.join(publicDir, 'favicon-32x32.png'), 32, 32);
  await generateIcon(faviconSvg, path.join(publicDir, 'favicon-16x16.png'), 16, 16);

  // Generate apple-touch-icon.png (180x180)
  await generateIcon(appleTouchSvg, path.join(publicDir, 'apple-touch-icon.png'), 180, 180);

  // Generate PWA icons
  await generateIcon(icon192Svg, path.join(publicDir, 'icon-192x192.png'), 192, 192);
  await generateIcon(icon512Svg, path.join(publicDir, 'icon-512x512.png'), 512, 512);

  // Generate OG image PNG from SVG
  const ogSvgPath = path.join(publicDir, 'og-image.svg');
  if (fs.existsSync(ogSvgPath)) {
    try {
      const ogSvg = fs.readFileSync(ogSvgPath);
      await sharp(ogSvg).resize(1200, 630).png().toFile(path.join(publicDir, 'og-image.png'));
      console.log('Created og-image.png');
    } catch (err) {
      throw new Error(`Failed to generate og-image.png: ${err.message}`);
    }
  } else {
    console.warn(`Warning: ${ogSvgPath} not found, skipping OG image generation`);
  }

  console.log('All icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err.message);
  process.exit(1);
});
