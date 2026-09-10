'use strict';
/**
 * Every custom property the stylesheet uses has to be defined somewhere in it.
 *
 * An undefined token is silent: `color: var(--muted)` with no --muted simply
 * inherits, so text keeps rendering in whatever colour it happened to have and
 * nothing errors. Three of these had crept in (--muted twice and --card once),
 * each one a colour that was never actually applied.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'styles.css'),
  'utf8'
);

test('every var(--token) the stylesheet reads is also defined in it', () => {
  const defined = new Set();
  for (const m of CSS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);

  const used = new Set();
  for (const m of CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) used.add(m[1]);

  const missing = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `stylesheet reads ${missing.length} token(s) it never defines: ${missing.join(', ')}`
  );
});

test('the tokens behind the guide steps and table tools are real', () => {
  // These two blocks were added without their colours existing, so guard the
  // exact names rather than only the general rule above.
  const defined = new Set();
  for (const m of CSS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);
  for (const token of ['--paper', '--line', '--brand', '--ink-soft']) {
    assert.ok(defined.has(token), `${token} should be defined`);
  }
});
