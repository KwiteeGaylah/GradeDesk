'use strict';
/**
 * Rasterises the SVG artwork into what the build needs.
 *
 *   build/icon.svg              -> icon.png and the smaller sizes
 *   build/installer-sidebar.svg -> installerSidebar.bmp  (164x314)
 *   build/installer-header.svg  -> installerHeader.bmp   (150x57)
 *
 * NSIS only accepts BMP for its wizard images, so those two are written as
 * uncompressed 24-bit bitmaps. Electron's own Chromium does the rendering, so
 * there is no image library to install.
 */
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');

/** Paint an SVG at an exact size and return the raw BGRA pixels. */
async function render(win, svgPath, width, height) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  await win.webContents.executeJavaScript(
    `(() => {
       document.body.style.cssText = 'margin:0;background:#fff';
       document.body.innerHTML = ${JSON.stringify(svg)};
       const s = document.querySelector('svg');
       s.setAttribute('width', ${width});
       s.setAttribute('height', ${height});
       return true;
     })()`
  );
  win.setContentSize(width, height);
  await new Promise((r) => setTimeout(r, 300));
  return win.webContents.capturePage({ x: 0, y: 0, width, height });
}

/**
 * Write a 24-bit uncompressed BMP.
 *
 * Rows are bottom-up and padded to a multiple of four bytes, which is the part
 * that silently produces a skewed image if you get it wrong.
 */
function writeBmp(image, file) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap(); // 4 bytes per pixel, BGRA
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const pixelBytes = (rowBytes + padding) * height;

  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + pixelBytes, 2);
  header.writeUInt32LE(54, 10);          // pixel data offset
  header.writeUInt32LE(40, 14);          // DIB header size
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);       // positive: rows stored bottom-up
  header.writeUInt16LE(1, 26);           // planes
  header.writeUInt16LE(24, 28);          // bits per pixel
  header.writeUInt32LE(pixelBytes, 34);
  header.writeInt32LE(2835, 38);         // 72 DPI
  header.writeInt32LE(2835, 42);

  const pixels = Buffer.alloc(pixelBytes);
  let out = 0;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      pixels[out] = bgra[i];         // blue
      pixels[out + 1] = bgra[i + 1]; // green
      pixels[out + 2] = bgra[i + 2]; // red
      out += 3;
    }
    out += padding;
  }

  fs.writeFileSync(file, Buffer.concat([header, pixels]));
}

async function makeIcons(win, app) {
  try {
    // App icon, at every size the installer and the shell ask for.
    for (const size of [512, 256, 128, 64, 48, 32, 16]) {
      const img = await render(win, path.join(BUILD, 'icon.svg'), size, size);
      const file = size === 512 ? 'icon.png' : `icon-${size}.png`;
      fs.writeFileSync(path.join(BUILD, file), img.toPNG());
      console.log('ICON: wrote', file);
    }

    // Installer artwork. NSIS fixes both of these sizes.
    const sidebar = await render(win, path.join(BUILD, 'installer-sidebar.svg'), 164, 314);
    writeBmp(sidebar, path.join(BUILD, 'installerSidebar.bmp'));
    console.log('ICON: wrote installerSidebar.bmp (164x314)');

    const header = await render(win, path.join(BUILD, 'installer-header.svg'), 150, 57);
    writeBmp(header, path.join(BUILD, 'installerHeader.bmp'));
    console.log('ICON: wrote installerHeader.bmp (150x57)');

    app.exit(0);
  } catch (err) {
    console.error('ICON FAILED:', err.message);
    app.exit(1);
  }
}

module.exports = { makeIcons };
