/**
 * Copies src/engine/presets.js into the renderer as a plain script.
 *
 * Same reason as the dates mirror: the renderer has no module system and needs
 * the preset list synchronously while it paints a dialog. Generating it keeps
 * the two from drifting; a test checks they match.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'engine', 'presets.js');
const out = path.join(__dirname, '..', 'src', 'renderer', 'presets.js');

let body = fs.readFileSync(src, 'utf8').replace(/^'use strict';\r?\n/, '');
body = body.replace(
  /module\.exports = \{[\s\S]*?\};\s*$/,
  'window.GradeDeskPresets = {\n  listPresets,\n  getPreset,\n  SAFE_POINTS,\n};\n'
);

const header =
  "'use strict';\n" +
  '/*\n' +
  ' * GENERATED FROM src/engine/presets.js - do not edit here.\n' +
  ' * Regenerate with: npm run build:presets\n' +
  ' *\n' +
  ' * The renderer has no module system and needs the preset list synchronously\n' +
  ' * while it paints, so the engine module is mirrored here rather than fetched\n' +
  ' * over IPC. A test asserts the two stay in step.\n' +
  ' */\n\n';

fs.writeFileSync(out, header + body);
console.log('wrote', path.relative(process.cwd(), out));
