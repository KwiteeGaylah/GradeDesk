'use strict';
/** Rasterises build/icon.svg into build/icon.png (512) and smaller sizes. */
const fs = require('fs');
const path = require('path');

async function makeIcons(win, app) {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  const out = path.join(__dirname, '..', 'build');
  try {
    for (const size of [512, 256, 128, 64, 48, 32, 16]) {
      await win.webContents.executeJavaScript(
        `(() => {
           document.body.style.cssText = 'margin:0;background:transparent';
           document.body.innerHTML = ${JSON.stringify(svg)};
           const s = document.querySelector('svg');
           s.setAttribute('width', ${size});
           s.setAttribute('height', ${size});
           return true;
         })()`
      );
      win.setContentSize(size, size);
      await new Promise((r) => setTimeout(r, 250));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      const file = size === 512 ? 'icon.png' : `icon-${size}.png`;
      fs.writeFileSync(path.join(out, file), img.toPNG());
      console.log('ICON: wrote', file);
    }
    app.exit(0);
  } catch (err) {
    console.error('ICON FAILED:', err.message);
    app.exit(1);
  }
}
module.exports = { makeIcons };
