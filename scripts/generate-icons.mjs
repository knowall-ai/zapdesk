import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

// Rasterises the committed SVG icons. The SVGs are the source of truth and are
// written by scripts/generate-logo.js; run that first after changing the mark
// or the brand colour. This script used to carry its own inline SVG copies,
// which still drew the old "D" glyph in the old green, so running it put a
// mark on every PNG that no longer matched the app.
const faviconSvg = fs.readFileSync(path.join(publicDir, 'favicon.svg'));
const appleTouchSvg = fs.readFileSync(path.join(publicDir, 'apple-touch-icon.svg'));

async function renderPng(svg, size) {
  return sharp(svg, { density: 1200 }).resize(size, size).png().toBuffer();
}

async function generateIcon(svg, outputPath, size) {
  try {
    fs.writeFileSync(outputPath, await renderPng(svg, size));
    console.log(`Created ${path.relative(rootDir, outputPath)}`);
  } catch (err) {
    throw new Error(`Failed to generate ${path.basename(outputPath)}: ${err.message}`);
  }
}

/** A Windows .ico holding PNG-encoded images (supported since Windows Vista). */
async function generateIco(svg, outputPath, sizes) {
  const images = await Promise.all(sizes.map((size) => renderPng(svg, size)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map((png, i) => {
    const entry = Buffer.alloc(16);
    const size = sizes[i];
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette size
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  fs.writeFileSync(outputPath, Buffer.concat([header, ...entries, ...images]));
  console.log(`Created ${path.relative(rootDir, outputPath)}`);
}

async function generateIcons() {
  console.log('Generating icons...');

  // Favicons
  await generateIcon(faviconSvg, path.join(publicDir, 'favicon-32x32.png'), 32);
  await generateIcon(faviconSvg, path.join(publicDir, 'favicon-16x16.png'), 16);
  await generateIco(faviconSvg, path.join(rootDir, 'src', 'app', 'favicon.ico'), [16, 32, 48]);

  // Apple touch icon and PWA icons
  await generateIcon(appleTouchSvg, path.join(publicDir, 'apple-touch-icon.png'), 180);
  await generateIcon(appleTouchSvg, path.join(publicDir, 'icon-192x192.png'), 192);
  await generateIcon(appleTouchSvg, path.join(publicDir, 'icon-512x512.png'), 512);

  // OG image
  const ogSvgPath = path.join(publicDir, 'og-image.svg');
  if (fs.existsSync(ogSvgPath)) {
    try {
      const ogSvg = fs.readFileSync(ogSvgPath);
      await sharp(ogSvg).resize(1200, 630).png().toFile(path.join(publicDir, 'og-image.png'));
      console.log('Created public/og-image.png');
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
