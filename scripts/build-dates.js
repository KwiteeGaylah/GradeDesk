/**
 * Copies src/engine/dates.js into the renderer as a plain script.
 *
 * The renderer has no module system and needs these formatters synchronously
 * while it paints, so the engine module is mirrored rather than fetched over
 * IPC. Generating it keeps the two from drifting; a test checks they match.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'engine', 'dates.js');
const out = path.join(__dirname, '..', 'src', 'renderer', 'dates.js');

let body = fs.readFileSync(src, 'utf8').replace(/^'use strict';\n/, '');
body = body.replace(
  /module\.exports = \{[\s\S]*?\};\s*$/,
  'window.GradeDeskDates = {\n' +
    '  MONTHS_SHORT,\n  formatDate,\n  formatDateShort,\n' +
    '  formatDateForFilename,\n  todayStored,\n};\n'
);

const header =
  "'use strict';\n" +
  '/*\n' +
  ' * GENERATED FROM src/engine/dates.js - do not edit here.\n' +
  ' * Regenerate with: npm run build:dates\n' +
  ' *\n' +
  ' * The renderer has no module system and needs these synchronously while it\n' +
  ' * paints, so the engine module is mirrored here rather than fetched over IPC.\n' +
  ' * A test asserts the two stay in step.\n' +
  ' */\n\n';

fs.writeFileSync(out, header + body);
console.log('wrote', path.relative(process.cwd(), out));
