'use strict';
/**
 * The guide has to keep up with the app.
 *
 * It is the only documentation an instructor has in front of them, and it went
 * stale twice: it still described entering one assessment at a time after the
 * grid became a whole term, and it never mentioned presets, duplicating a
 * course, renumbering, the right-click menus or the search and sort that every
 * screen carries.
 *
 * These read the guide's own data rather than the rendered page, so a feature
 * documented nowhere fails here instead of being found by a confused user.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'guide.js'),
  'utf8'
);
const APP = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'app.js'),
  'utf8'
);

/** Every word of prose in the guide, lower-cased. */
const PROSE = GUIDE.toLowerCase();

test('every screen in the app is explained', () => {
  for (const [screen, phrase] of [
    ['grade entry', 'entering scores'],
    ['attendance', 'attendance'],
    ['roster', 'class list'],
    ['assessments', 'assessments'],
  ]) {
    assert.ok(PROSE.includes(phrase), `${screen} should be covered (looked for "${phrase}")`);
  }
});

test('the features that are easy to miss are documented', () => {
  // Each of these is a real button or menu in the app. A user who never finds
  // them does the work the long way round.
  const missing = [];
  for (const [feature, needle] of [
    ['presets', 'preset'],
    ['duplicating a course', 'duplicate'],
    ['renumbering the roster', 'renumber'],
    ['the right-click menu', 'right-click'],
    ['reordering assessments', 'move it up or down'],
    ['the search box', 'search box'],
    ['the sort menu', 'sort menu'],
    ['backups', 'backing up'],
    ['the sample class list', 'sample'],
    ['students not on the roster', 'addendum'],
    ['folding the left panel', 'folds the left panel'],
  ]) {
    if (!PROSE.includes(needle)) missing.push(`${feature} (looked for "${needle}")`);
  }
  assert.deepEqual(missing, [], `${missing.length} feature(s) the guide never mentions`);
});

test('the guide teaches the class list format the app actually expects', () => {
  // The four columns of the official list. Getting this wrong in the guide
  // sends people to paste a list that lands in the wrong fields.
  for (const column of ['student id', 'last name', 'first name', 'middle name']) {
    assert.ok(PROSE.includes(column), `the guide should name the "${column}" column`);
  }
});

test('the guide does not describe the old one-assessment-at-a-time screen', () => {
  // The entry grid shows a whole term now. These phrases described the screen
  // as it was before and would send someone looking for a control that is gone.
  for (const stale of [
    'one assessment at a time',
    'dropdown at the top',
    'no 20-point column',
  ]) {
    assert.ok(!PROSE.includes(stale), `the guide still says "${stale}"`);
  }
});

test('the keys the guide teaches are the keys the app binds', () => {
  // Enter goes down a column and Tab goes across a row. If the guide and the
  // handler ever disagree, one of them is lying to the instructor.
  assert.match(GUIDE, /\['Enter', 'Save and drop to the next student, down the column'\]/);
  assert.match(GUIDE, /\['Tab', 'Save and move across to the next assessment'\]/);
  assert.match(APP, /event\.key === 'Enter'[\s\S]*?focusFrom\(row, col, 1, 0\)/,
    'the app moves down on Enter');
  assert.match(APP, /event\.key === 'Tab'[\s\S]*?focusFrom\(row, col, 0, 1\)/,
    'and across on Tab');
});

test('every section has a title and some content', () => {
  const ids = [...GUIDE.matchAll(/\n    id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 10, `only ${ids.length} sections`);
  assert.equal(new Set(ids).size, ids.length, 'section ids should be unique');
  // Each section declares blocks; an empty one renders as a bare heading.
  const sections = GUIDE.split(/\n  \{\n    id: '/).slice(1);
  for (const section of sections) {
    const id = section.slice(0, section.indexOf("'"));
    assert.ok(/title:/.test(section), `${id} has no title`);
    assert.ok(/blocks: \[/.test(section), `${id} has no blocks`);
    assert.ok(/type: '/.test(section), `${id} has no content`);
  }
});
