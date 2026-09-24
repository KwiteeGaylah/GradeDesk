'use strict';
/**
 * The class-list sorting shared by every screen.
 *
 * Grade entry, the roster and attendance each used to build their own sorter
 * list. The same class could therefore be in three different orders depending
 * on which screen you were looking at, and attendance had no sort at all —
 * which matters, because attendance is marked by reading down a column against
 * a printed list. A grid in a different order from the list in your hand is
 * how a mark lands on the wrong student.
 *
 * src/renderer/sorting.js has no module system (the renderer loads plain
 * scripts), so it is evaluated here in a sandbox with a stand-in `window` and
 * the real thing is then exercised directly.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'sorting.js'),
  'utf8'
);

/** Evaluate the renderer module and hand back what it publishes. */
function loadSorting() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return sandbox.window.GradeDeskSorting;
}

const Sorting = loadSorting();

/** A student record shaped like the store's. */
const student = (id, last, first, middle = '', extra = {}) => ({
  id,
  sort_order: id,
  number: id,
  student_id: String(10000 + id),
  last_name: last,
  first_name: first,
  middle_name: middle,
  full_name: middle ? `${last}, ${first} ${middle}` : `${last}, ${first}`,
  ...extra,
});

const CLASS = [
  student(1, 'Nyema', 'Ernest'),
  student(2, 'Bestman', 'Comfort', 'K.'),
  student(3, 'Dolo', 'Patience'),
  student(4, 'bestman', 'Alfred'), // lower case: casing must not sort separately
];

const namesIn = (sort, rows = CLASS) =>
  Sorting.sortRows(rows, sort, { student: (s) => s }).map((s) => `${s.last_name} ${s.first_name}`);

test('surname order is the default every screen opens on', () => {
  assert.equal(Sorting.DEFAULT_SORT, 'last');
});

test('sorting by last name is alphabetical and ignores casing', () => {
  assert.deepEqual(namesIn('last'), [
    'bestman Alfred',
    'Bestman Comfort',
    'Dolo Patience',
    'Nyema Ernest',
  ]);
});

test('two students sharing a surname are ordered by their first name', () => {
  const [first, second] = namesIn('last');
  assert.equal(first, 'bestman Alfred');
  assert.equal(second, 'Bestman Comfort');
});

test('sorting by first name is offered and is a different order', () => {
  assert.deepEqual(namesIn('first'), [
    'bestman Alfred',
    'Bestman Comfort',
    'Nyema Ernest',
    'Dolo Patience',
  ]);
});

test('each name sort has a reverse', () => {
  assert.deepEqual(namesIn('last-desc'), namesIn('last').reverse());
  assert.deepEqual(namesIn('first-desc'), namesIn('first').reverse());
});

test('student ID sorts numerically, not as text', () => {
  const rows = [
    student(1, 'A', 'A', '', { student_id: '10' }),
    student(2, 'B', 'B', '', { student_id: '9' }),
    student(3, 'C', 'C', '', { student_id: '100' }),
  ];
  const ids = Sorting.sortRows(rows, 'id', { student: (s) => s }).map((s) => s.student_id);
  assert.deepEqual(ids, ['9', '10', '100'], '"10" must not come before "9"');
});

test('roster order is the instructor\'s own arrangement', () => {
  assert.deepEqual(namesIn('roster'), [
    'Nyema Ernest',
    'Bestman Comfort',
    'Dolo Patience',
    'bestman Alfred',
  ]);
});

test('a student migrated from version 1 still sorts by surname', () => {
  // The parts are empty until the migration fills them, and a row edited in an
  // older build could still arrive this way. The written name carries it.
  const legacy = [
    { id: 1, sort_order: 1, student_id: '1', full_name: 'Zuo, Mary', last_name: '', first_name: '', middle_name: '' },
    { id: 2, sort_order: 2, student_id: '2', full_name: 'Andrews, Paul', last_name: '', first_name: '', middle_name: '' },
  ];
  const order = Sorting.sortRows(legacy, 'last', { student: (s) => s }).map((s) => s.full_name);
  assert.deepEqual(order, ['Andrews, Paul', 'Zuo, Mary']);
});

test('namePart reads a surname-first name that has no comma', () => {
  const row = { full_name: 'Nyema Ernest', last_name: '', first_name: '' };
  assert.equal(Sorting.namePart(row, 'last_name'), 'Nyema');
  assert.equal(Sorting.namePart(row, 'first_name'), 'Ernest');
});

// ----------------------------------------------------------- score sorting

test('a blank score sinks to the bottom whichever way the sort runs', () => {
  const rows = [
    { student: student(1, 'A', 'A'), raw: null },
    { student: student(2, 'B', 'B'), raw: 12 },
    { student: student(3, 'C', 'C'), raw: 5 },
  ];
  const accessors = { student: (r) => r.student, raw: (r) => r.raw };

  const high = Sorting.sortRows(rows, 'raw-desc', accessors).map((r) => r.raw);
  const low = Sorting.sortRows(rows, 'raw-asc', accessors).map((r) => r.raw);
  assert.deepEqual(high, [12, 5, null], 'a blank is not the highest score');
  assert.deepEqual(low, [5, 12, null], 'nor the lowest');
});

test('"blanks first" brings unentered scores to the top', () => {
  const rows = [
    { student: student(1, 'A', 'A'), raw: 9 },
    { student: student(2, 'B', 'B'), raw: null },
  ];
  const order = Sorting.sortRows(rows, 'blank', {
    student: (r) => r.student,
    raw: (r) => r.raw,
  }).map((r) => r.raw);
  assert.deepEqual(order, [null, 9]);
});

test('letter grades sort A to F, with I and NG last', () => {
  const rows = ['F', 'A', 'NG', 'C', 'I'].map((letter, i) => ({
    student: student(i + 1, `S${i}`, 'X'),
    letter,
  }));
  const order = Sorting.sortRows(rows, 'letter', {
    student: (r) => r.student,
    letter: (r) => r.letter,
  }).map((r) => r.letter);
  assert.deepEqual(order, ['A', 'C', 'F', 'I', 'NG']);
});

test('sorting never mutates the caller\'s array', () => {
  const rows = [...CLASS];
  const before = rows.map((s) => s.id);
  Sorting.sortRows(rows, 'last', { student: (s) => s });
  assert.deepEqual(rows.map((s) => s.id), before);
});

test('an unknown sort falls back to the default rather than throwing', () => {
  assert.deepEqual(namesIn('not-a-sort'), namesIn('last'));
});

// ------------------------------------------------------------ the menu itself

test('every screen offers the same name and ID options, in the same order', () => {
  const common = ['roster', 'last', 'last-desc', 'first', 'first-desc', 'id'];
  for (const features of [{}, { score: true }, { score: true, grade: true }, { roster: true }]) {
    const values = Sorting.sortOptions(features).map(([v]) => v);
    assert.deepEqual(values.slice(0, common.length), common);
  }
});

test('score and grade options appear only where there is something to sort', () => {
  const plain = Sorting.sortOptions({}).map(([v]) => v);
  assert.ok(!plain.includes('raw-desc'), 'no score column, no score sort');
  assert.ok(!plain.includes('grade-desc'), 'no grade on screen, no grade sort');

  const entry = Sorting.sortOptions({ score: true, grade: true }).map(([v]) => v);
  assert.ok(entry.includes('raw-desc'));
  assert.ok(entry.includes('grade-desc'));
  assert.ok(entry.includes('letter'));
});

test('every option has a label a person can read', () => {
  for (const [value, label] of Sorting.sortOptions({ score: true, grade: true, roster: true })) {
    assert.ok(value && typeof value === 'string');
    assert.ok(label && label.length > 2, `${value} needs a readable label`);
  }
});

test('the first-name option says "first name", not just "name"', () => {
  // The whole point of splitting names is being able to tell the two apart, so
  // the menu has to say which one it is sorting by.
  const labels = new Map(Sorting.sortOptions({}));
  assert.match(labels.get('last'), /last name/i);
  assert.match(labels.get('first'), /first name/i);
});
