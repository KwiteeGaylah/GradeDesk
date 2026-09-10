/**
 * Packs the rendered PNG icons into a multi-size Windows .ico.
 *
 * The installer and the uninstaller both want an .ico rather than a PNG.
 * An ICO is a small directory followed by the images themselves, and modern
 * Windows accepts PNG-compressed entries, so the PNGs go in unchanged.
 *
 * Run with: npm run icon (which calls this afterwards)
 */
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [16, 32, 48, 64, 128, 256];

const images = SIZES.map((size) => {
  const file = size === 512 ? 'icon.png' : `icon-${size}.png`;
  const full = path.join(BUILD, file);
  if (!fs.existsSync(full)) throw new Error(`missing ${file}; run the icon renderer first`);
  return { size, data: fs.readFileSync(full) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);              // reserved
header.writeUInt16LE(1, 2);              // 1 = icon
header.writeUInt16LE(images.length, 4);

const entries = [];
let offset = 6 + images.length * 16;
for (const { size, data } of images) {
  const e = Buffer.alloc(16);
  // 256 is written as 0, which is the format's way of saying "256".
  e.writeUInt8(size >= 256 ? 0 : size, 0);
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt8(0, 2);                    // palette colours
  e.writeUInt8(0, 3);                    // reserved
  e.writeUInt16LE(1, 4);                 // colour planes
  e.writeUInt16LE(32, 6);                // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += data.length;
}

const out = path.join(BUILD, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
console.log('ICON: wrote icon.ico with', images.length, 'sizes');
