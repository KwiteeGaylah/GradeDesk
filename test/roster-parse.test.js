'use strict';
/**
 * Roster paste parsing.
 *
 * The official class list handed to instructors has four columns —
 * Student ID, Last Name, First Name, Middle Name — and the paste box is built
 * around that format so a list goes straight in without being retyped. Names
 * are stored as parts so the roster can be sorted by surname or given name.
 *
 * Names here are written "Surname, Given", so a comma is part of the name far
 * more often than it is a separator. An earlier version split on tabs and
 * commas together and turned "Bestman, Comfort K." into "Bestman Comfort K."
 * for every pasted row, found by driving the real app.
 *
 * The parser lives in src/engine/roster.js rather than in the renderer, so it
 * can be tested directly instead of only through the running application.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  parseRosterLine,
  parseRosterText,
  joinName,
  splitName,
  isHeaderLine,
} = require('../src/engine');

/** Shorthand for the full parsed shape, so each test reads as one line. */
const row = (studentId, lastName, firstName, middleName) => ({
  studentId,
  lastName,
  firstName,
  middleName,
  fullName: joinName({ lastName, firstName, middleName }),
});

// ------------------------------------------- the administration's format

test('the official four columns parse in order: ID, last, first, middle', () => {
  assert.deepEqual(
    parseRosterLine('10001\tBestman\tComfort\tK.'),
    row('10001', 'Bestman', 'Comfort', 'K.')
  );
});

test('a missing middle name is simply empty', () => {
  assert.deepEqual(
    parseRosterLine('10002\tDolo\tPatience'),
    row('10002', 'Dolo', 'Patience', '')
  );
});

test('a multi-word surname stays in its own column', () => {
  assert.deepEqual(
    parseRosterLine('10003\tVan Der Berg\tAnna\tMarie'),
    row('10003', 'Van Der Berg', 'Anna', 'Marie')
  );
});

test('extra name columns fold into the middle name rather than being dropped', () => {
  assert.deepEqual(
    parseRosterLine('10004\tKollie\tJames\tT.\tJunior'),
    row('10004', 'Kollie', 'James', 'T. Junior')
  );
});

test('the four columns also work when separated by a couple of spaces', () => {
  // Tab used to move focus out of the paste box, so someone typing by hand
  // reaches for spaces instead. Both mean the same thing.
  assert.deepEqual(
    parseRosterLine('10001  Bestman  Comfort  K.'),
    row('10001', 'Bestman', 'Comfort', 'K.')
  );
});

test('a header row copied along with the data is skipped', () => {
  const block = [
    'Student ID\tLast Name\tFirst Name\tMiddle Name',
    '10001\tBestman\tComfort\tK.',
  ].join('\n');
  const rows = parseRosterText(block);
  assert.equal(rows.length, 1, 'the heading is not a student');
  assert.deepEqual(rows[0], row('10001', 'Bestman', 'Comfort', 'K.'));
});

test('a real name is never mistaken for a header row', () => {
  assert.equal(isHeaderLine('10001\tBestman\tComfort\tK.'), false);
  assert.equal(isHeaderLine('Student ID\tLast Name\tFirst Name'), true);
});

// ------------------------------------------------- version 1 paste formats

test('a tab separates the ID from a name that contains commas', () => {
  assert.deepEqual(
    parseRosterLine('10001\tBestman, Comfort K.'),
    row('10001', 'Bestman', 'Comfort', 'K.')
  );
});

test('a non-numeric ID still works with a tab', () => {
  assert.deepEqual(
    parseRosterLine('TU-90001\tDolo, Patience M.'),
    row('TU-90001', 'Dolo', 'Patience', 'M.')
  );
});

test('a name alone keeps its comma and is not treated as an ID', () => {
  assert.deepEqual(
    parseRosterLine('Bestman, Comfort K.'),
    row('', 'Bestman', 'Comfort', 'K.')
  );
});

test('a comma separates only when the head looks like an ID', () => {
  assert.deepEqual(
    parseRosterLine('10001, Bestman, Comfort K.'),
    row('10001', 'Bestman', 'Comfort', 'K.')
  );
});

test('a fully comma-separated row lands the same as the tabbed one', () => {
  assert.deepEqual(
    parseRosterLine('10001, Bestman, Comfort, K.'),
    row('10001', 'Bestman', 'Comfort', 'K.')
  );
});

test('surrounding whitespace is trimmed from every part', () => {
  assert.deepEqual(
    parseRosterLine('  10001 \t  Cooper, Grace A.  '),
    row('10001', 'Cooper', 'Grace', 'A.')
  );
});

test('a surname that happens to contain a digit is not mistaken for an ID', () => {
  // "Smith 2nd, John" has a digit but also a space, so it is a name.
  assert.deepEqual(parseRosterLine('Smith 2nd, John'), row('', 'Smith 2nd', 'John', ''));
});

test('a pasted block skips blank lines and parses each row', () => {
  const block = ['10001\tBestman, Comfort K.', '', '   ', '10002\tBestman, Daniel T.', ''].join('\n');
  const rows = parseRosterText(block);
  assert.equal(rows.length, 2, 'blank and whitespace-only lines are skipped');
  assert.deepEqual(rows[0], row('10001', 'Bestman', 'Comfort', 'K.'));
  assert.deepEqual(rows[1], row('10002', 'Bestman', 'Daniel', 'T.'));
});

test('a block pasted with Windows line endings parses the same', () => {
  const rows = parseRosterText('10001\tBestman, Comfort K.\r\n10002\tBestman, Daniel T.\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, 'Bestman, Comfort K.');
});

// ---------------------------------------------------- the single-space case

test('a single space after an ID is a separator, not part of the name', () => {
  // THE BUG: version 1 read this whole line as one name and left the student
  // with no ID at all. The grade screen then had nothing to key a score to,
  // so no transmuted value appeared, while the export — which reads the same
  // rows a different way — still looked right. Both now agree.
  assert.deepEqual(
    parseRosterLine('10001 Bestman Comfort K.'),
    row('10001', 'Bestman', 'Comfort', 'K.')
  );
  assert.deepEqual(parseRosterLine('10002 Doe Jane'), row('10002', 'Doe', 'Jane', ''));
});

test('a name with no ID in front of it is still read surname-first', () => {
  // The official list is surname-first, so an untagged name follows it.
  assert.deepEqual(parseRosterLine('Freeman Mercy'), row('', 'Freeman', 'Mercy', ''));
});

test('a lone word is a surname', () => {
  assert.deepEqual(parseRosterLine('Bestman'), row('', 'Bestman', '', ''));
});

// ------------------------------------------------------- joining and splitting

test('joinName punctuates only what is there', () => {
  assert.equal(joinName({ lastName: 'Bestman', firstName: 'Comfort', middleName: 'K.' }), 'Bestman, Comfort K.');
  assert.equal(joinName({ lastName: 'Bestman', firstName: 'Comfort' }), 'Bestman, Comfort');
  assert.equal(joinName({ lastName: 'Bestman' }), 'Bestman', 'no trailing comma');
  assert.equal(joinName({ firstName: 'Comfort' }), 'Comfort', 'no leading comma');
  assert.equal(joinName({}), '');
});

test('splitName is the reverse of joinName for a written name', () => {
  for (const name of ['Bestman, Comfort K.', 'Nagbe, S Jonathan T.', 'Dolo, Patience', 'Bestman']) {
    assert.equal(joinName(splitName(name)), name, `${name} did not round-trip`);
  }
});

test('a comma-form name keeps a multi-word surname whole', () => {
  assert.deepEqual(splitName('Van Der Berg, Anna Marie'), {
    lastName: 'Van Der Berg',
    firstName: 'Anna',
    middleName: 'Marie',
  });
});

test('every name in the real workbook survives a tab paste', async () => {
  const { loadWorkbook } = require('./workbook-fixture');
  const sections = await loadWorkbook();
  const mangled = [];
  for (const section of sections) {
    for (const s of section.students) {
      const parsed = parseRosterLine(`${s.studentId ?? ''}\t${s.fullName}`);
      // The canonical form: the parts rejoined. Two of the 167 names in the
      // source workbook were typed without a comma, and splitting them
      // punctuates them like everyone else, which is the point of the parts.
      const expected = joinName(splitName(s.fullName));
      if (parsed.fullName !== expected) {
        mangled.push(`"${s.fullName}" became "${parsed.fullName}"`);
      }
    }
  }
  assert.deepEqual(mangled, [], `${mangled.length} name(s) mangled by the paste parser`);
});
