'use strict';
/**
 * Every script the window loads has to parse.
 *
 * The renderer's scripts are plain files loaded by <script> tags, so nothing
 * in the unit suite ever compiles them: the guide test reads guide.js as text.
 * A stray apostrophe in a single-quoted string once left guide.js unparseable
 * while every test still passed, and the app would have opened with no guide.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'src', 'renderer');

test('every renderer script parses', () => {
  const scripts = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  assert.ok(scripts.includes('app.js') && scripts.includes('guide.js'));
  for (const file of scripts) {
    const source = fs.readFileSync(path.join(DIR, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), `${file} does not parse`);
  }
});
