'use strict';
/**
 * Module wiring.
 *
 * The export handlers open a save dialog, so no automated test drives them to
 * completion. A missing import there stayed invisible until it was clicked and
 * failed with "todayStored is not defined". This runs the reference checker as
 * part of the suite so that class of bug fails here instead.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

test('every module loads and main.js imports everything it calls', () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-references.js');
  let output = '';
  try {
    output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  } catch (err) {
    assert.fail(`${err.stdout || ''}${err.stderr || ''}`);
  }
  assert.match(output, /all module references resolve/);
});
