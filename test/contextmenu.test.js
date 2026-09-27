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

/** The stylesheet, for the layout guarantees asserted at the end of this file. */
const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'styles.css'),
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

test('no event inside the menu dismisses it', () => {
  // Not just right-clicks. The guard once read
  //   if (e.type === 'contextmenu' && menu.contains(e.target)) return;
  // so a left mousedown on an item fell through to closeContextMenu. mousedown
  // precedes click, so the node was gone before the button's own handler ran:
  // every menu item silently did nothing.
  const src = menuSource();
  assert.ok(
    /menu\.contains\(\s*e\.target\s*\)/.test(src),
    'the dismiss handler must ignore events inside the menu itself'
  );
  const guard = src.slice(src.indexOf('const dismiss'), src.indexOf('menuTeardown ='));
  assert.ok(
    !/e\.type\s*===\s*'contextmenu'\s*&&/.test(guard),
    'the in-menu guard must not be limited to contextmenu events'
  );
});

test('menu items close the menu themselves', () => {
  // Since dismissal ignores in-menu events, each item is responsible for
  // closing before it acts, or the menu would stay open after being used.
  const src = menuSource();
  const item = src.slice(src.indexOf('onclick:'), src.indexOf('document.body.append'));
  assert.ok(
    item.indexOf('closeContextMenu()') < item.indexOf('item.onClick()'),
    'an item closes the menu before running its action'
  );
});

// ------------------- the reconstructed-column notice -----------------------

/**
 * The 70% 20-point column is derived rather than copied from the university
 * table, so it must say so where it is chosen. These are source-level checks,
 * like the rest of this file: the renderer has no module system and cannot be
 * required. The rendered result was verified by driving the real app.
 */

test('the derived-column notice is its own note, not nested inside another', () => {
  // A .hint inside a .note inherits neither colour cleanly: it rendered grey on
  // the green note background while the text around it was dark green.
  const start = APP.indexOf('const derivedNote = derived.length');
  assert.ok(start > 0, 'renderConfig should build a derivedNote');
  const block = APP.slice(start, start + 900);
  assert.match(block, /class: 'note warn'/, 'it is a warning note in its own right');
  assert.ok(!/class: 'hint'/.test(block), 'and not a hint nested in the note above it');
});

test('the derived-column notice is only built when there is one', () => {
  // A 60% course has no derived column and must show no notice at all.
  const start = APP.indexOf('const derivedNote = derived.length');
  const block = APP.slice(start, start + 900);
  assert.match(block, /derived\.length\s*\?/, 'guarded on there being a derived column');
  assert.match(block, /:\s*null/, 'and nothing is rendered otherwise');
});

test('the derived-column notice reads correctly for one or many', () => {
  const start = APP.indexOf('const derivedNote = derived.length');
  const block = APP.slice(start, start + 900);
  // Singular/plural is chosen rather than hardcoded, so a second derived column
  // cannot produce "20 and 35 points is worked out".
  assert.match(block, /derived\.length === 1 \? ' is ' : ' are '/);
  assert.match(block, /It follows|They follow/);
  assert.match(block, /listPhrase\(/, 'the values are joined as a readable list');
});

test('listPhrase joins a list the way a person writes one', () => {
  // Extracted and evaluated, so the helper itself is exercised rather than
  // just asserted to exist.
  const src = APP.slice(APP.indexOf('function listPhrase'));
  const body = src.slice(0, src.indexOf('\n}') + 2);
  // eslint-disable-next-line no-new-func
  const listPhrase = new Function(`${body}; return listPhrase;`)();
  assert.equal(listPhrase([]), '');
  assert.equal(listPhrase(['20 points']), '20 points');
  assert.equal(listPhrase(['20', '35']), '20 and 35');
  assert.equal(listPhrase(['20', '35', '40']), '20, 35 and 40');
});

// ------------------- the entry grid holds a whole term ---------------------

/**
 * Grade entry shows every assessment in the term at once, one column each,
 * because the instructor's own workbook was laid out that way: Attendance,
 * Assign 1, Quiz 1, Quiz 2, ClassWork and the exam were all columns on one
 * sheet. Recording one column at a time meant switching assessment to enter an
 * assignment and a quiz from the same sitting.
 *
 * Source-level checks, as elsewhere in this file. The behaviour itself was
 * verified by driving the real app.
 */

test('the entry grid builds a column per assessment, not one at a time', () => {
  const start = APP.indexOf('async function renderGradeEntry');
  assert.ok(start > 0);
  const fn = APP.slice(start, APP.indexOf('\nfunction onEntryKey'));
  assert.match(fn, /const columns = all\.filter/, 'the columns are the assessments of the term');
  assert.match(fn, /columns\.flatMap/, 'and each one becomes a cell');
  // The old single-assessment picker must be gone, or two designs would coexist.
  assert.ok(!/class: 'apicker'/.test(fn), 'the single-assessment picker is gone');
});

test('entry cells carry a row and a column, so the keyboard can move in 2-D', () => {
  const start = APP.indexOf('async function renderGradeEntry');
  const fn = APP.slice(start, APP.indexOf('\nfunction onEntryKey'));
  assert.match(fn, /row: String\(rowIndex\)/);
  assert.match(fn, /col: String\(colIndex\)/);
  assert.match(fn, /assessmentId: String\(assessment\.id\)/,
    'each cell knows which assessment it belongs to');
});

test('Enter goes down the column and Tab goes across the row', () => {
  const start = APP.indexOf('function onEntryKey');
  const fn = APP.slice(start, start + 3000);
  // Down is (1, 0); across is (0, 1). Getting these the wrong way round would
  // make entering one pile of papers require a keystroke per cell.
  assert.match(fn, /event\.key === 'Enter'[\s\S]*?focusFrom\(row, col, 1, 0\)/,
    'Enter moves down');
  assert.match(fn, /event\.key === 'Tab'[\s\S]*?focusFrom\(row, col, 0, 1\)/,
    'Tab moves across');
});

test('movement skips a read-only attendance column', () => {
  const start = APP.indexOf('function onEntryKey');
  const fn = APP.slice(start, start + 3000);
  assert.match(fn, /!next\.readOnly/, 'it looks for a typeable cell');
  assert.match(fn, /for \(let guard = 0/, 'and cannot loop forever looking');
});

test('the computed cells are found by role, never by a fixed index', () => {
  // The grid has a variable number of columns, so cells[4] would point at a
  // different thing depending on the term and the transmuted toggle.
  const start = APP.indexOf('function updateComputedColumns');
  const fn = APP.slice(start, start + 2200);
  assert.match(fn, /data-role=/, 'roles identify the computed cells');
  assert.match(fn, /data-student-id=/, 'and rows are matched by student');
  assert.ok(!/cells\[\d\]/.test(fn), 'no fixed cell indices remain');
});

// ------------- the entry grid reads live data, not a snapshot --------------

/**
 * Committing a score calls refreshComputed, which REPLACES state.computed with
 * a new object. A render closure that held the students array it started with
 * therefore went stale the moment anything was typed: re-sorting or searching
 * afterwards redrew every cell from pre-edit data, so scores that were safely
 * in the database vanished from the screen. Found by typing a score, changing
 * the sort, and comparing the grid against gradebook.compute.
 */

test('the entry grid re-reads the computed class on every render', () => {
  const start = APP.indexOf('function renderGradeRows');
  assert.ok(start > 0);
  const fn = APP.slice(start, start + 2500);
  assert.match(fn, /const current = \(state\.computed && state\.computed\.students\)/,
    'it reads state.computed at render time');
  assert.match(fn, /current\.filter\(/, 'and sorts from that, not the captured array');
  assert.ok(!/\bstudents\.filter\(/.test(fn),
    'the array captured when the screen was built must not be re-sorted');
});

test('the attendance grid re-reads the computed class too', () => {
  // Marking a session calls refreshComputed the same way.
  const start = APP.indexOf('function renderAttendanceRows');
  assert.ok(start > 0);
  const fn = APP.slice(start, start + 2000);
  assert.match(fn, /const current = \(state\.computed && state\.computed\.students\)/);
  assert.match(fn, /current\.filter\(/);
  assert.ok(!/\bstudents\.filter\(/.test(fn));
});

test('the pinned grade and letter are released when the grid gets wide', () => {
  // The final grade and letter are sticky so they stay in view while a wide
  // grid scrolls. Sticky cells float above the row, so with the transmuted
  // columns shown they landed on top of the term total and hid it entirely:
  // the screen read "Class std." straight into "Final grade". Measured at
  // 1264px: the total spanned to 1123 while the grade began at 1104.
  assert.match(CSS, /\.entrytable\.with-trans td\.final[\s\S]{0,200}position: static/,
    'with-trans must un-pin the final grade and letter');
});

test('the transmuted columns are declared narrow enough to fit beside the totals', () => {
  // Each transmuted column is per-assessment, so a few pixels each decides
  // whether the running totals stay on screen.
  assert.match(CSS, /\.entrytable th\.th-trans,[\s\S]{0,120}width: 26px/);
  // The shared thead padding would otherwise size the table from its headings
  // rather than from these column widths.
  assert.match(CSS, /\.entrytable thead th \{[^}]*padding-left: 4px/);
});
