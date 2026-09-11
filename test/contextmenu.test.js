'use strict';
/**
 * The right-click menu's dismissal listeners.
 *
 * The first version registered four {once: true} listeners and never removed
 * them. Closing the menu by any other path (Escape, or picking an item) left
 * spent-but-live listeners behind, so the next right-click hit a stale
 * contextmenu handler that consumed itself closing nothing. The menu then
 * appeared on some clicks and not others.
 *
 * These are source-level checks rather than DOM tests: the renderer has no
 * module system and cannot be required, so the guarantees are asserted against
 * the source text. Behaviour itself was verified by driving the running app.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'app.js'),
  'utf8'
);

/**
 * The menu lifecycle only: contextMenu through closeContextMenu.
 *
 * Deliberately stops before the permanent Escape keydown listener, which is
 * registered once for the life of the app and is not part of the per-menu
 * teardown these tests are about.
 *
 * Comments are stripped, because the code carries an explanation of the old
 * {once: true} bug and a test that greps for that string would otherwise match
 * the description of the very thing it is checking is gone.
 */
function menuSource() {
  const start = APP.indexOf('function contextMenu(');
  // Anchored past closeContextMenu: there is an earlier keydown listener for
  // the modals, and searching from the start of the file found that one,
  // producing a backwards slice that silently matched nothing.
  const close = APP.indexOf('function closeContextMenu');
  const end = APP.indexOf("document.addEventListener('keydown'", close);
  assert.ok(start > -1 && end > start, 'context menu source not found');
  return APP.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('dismissal listeners are never registered with once', () => {
  // {once: true} is what made the listeners un-removable: they fire, remove
  // themselves, and any that never fired stay attached forever.
  const src = menuSource();
  assert.ok(
    !/once:\s*true/.test(src),
    'the menu must not use {once: true}; it needs an explicit teardown instead'
  );
});

test('every added dismissal listener has a matching remove', () => {
  const src = menuSource();
  const added = [...src.matchAll(/(document|window)\.addEventListener\(\s*'([a-z]+)'/g)]
    .map((m) => `${m[1]}:${m[2]}`);
  const removed = [...src.matchAll(/(document|window)\.removeEventListener\(\s*'([a-z]+)'/g)]
    .map((m) => `${m[1]}:${m[2]}`);

  assert.ok(added.length >= 4, `expected the dismissal listeners, found ${added.length}`);
  for (const listener of added) {
    assert.ok(
      removed.includes(listener),
      `${listener} is added but never removed, so it leaks between menus`
    );
  }
});

test('closing the menu runs the teardown before removing the node', () => {
  const src = menuSource();
  const close = src.slice(src.indexOf('function closeContextMenu'));
  assert.ok(
    /menuTeardown\s*\(\s*\)/.test(close),
    'closeContextMenu must run the teardown, or listeners outlive the menu'
  );
  assert.ok(
    close.indexOf('menuTeardown') < close.indexOf('querySelectorAll'),
    'the teardown runs before the node is removed'
  );
});

test('the teardown handle is declared before the function that assigns it', () => {
  // Assigning to a let before its declaration is evaluated throws. Nothing
  // opens a menu during load today, but relying on that is a trap.
  assert.ok(
    APP.indexOf('let menuTeardown') < APP.indexOf('function contextMenu('),
    'menuTeardown must be declared above contextMenu'
  );
});

test('listeners are attached in the capture phase', () => {
  // A menu item that stops propagation would otherwise strand the menu open.
  const src = menuSource();
  const adds = [...src.matchAll(/document\.addEventListener\([^)]*\)/g)].map((m) => m[0]);
  for (const add of adds) {
    assert.ok(/true/.test(add), `capture phase expected: ${add}`);
  }
});

test('a right-click inside the menu does not dismiss it', () => {
  const src = menuSource();
  assert.ok(
    /menu\.contains\(\s*e\.target\s*\)/.test(src),
    'the dismiss handler must ignore right-clicks inside the menu itself'
  );
});
