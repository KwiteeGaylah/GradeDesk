'use strict';
/**
 * Roster paste parsing.
 *
 * WVSTU names are written "Surname, Given", so a comma is part of the name far
 * more often than it is a separator. An earlier version split on tabs and
 * commas together and turned "Bestman, Comfort K." into
 * "Bestman Comfort K." for every pasted row, found by driving the real app.
 *
 * The parser lives in src/engine/roster.js rather than in the renderer, so it
 * can be tested directly instead of only through the running application.
 */

const test = require('node:test');
const assert = require('node:assert');
const { parseRosterLine, parseRosterText } = require('../src/engine');

test('a tab separates the ID from a name that contains commas', () => {
  assert.deepEqual(parseRosterLine('10001\tBestman, Comfort K.'), {
    studentId: '10001',
    fullName: 'Bestman, Comfort K.',
  });
});

test('a non-numeric ID still works with a tab', () => {
  assert.deepEqual(parseRosterLine('TU-90001\tDolo, Patience M.'), {
    studentId: 'TU-90001',
    fullName: 'Dolo, Patience M.',
  });
});

test('a name alone keeps its comma and is not treated as an ID', () => {
  assert.deepEqual(parseRosterLine('Bestman, Comfort K.'), {
    studentId: '',
    fullName: 'Bestman, Comfort K.',
  });
});

test('a comma separates only when the head looks like an ID', () => {
  assert.deepEqual(parseRosterLine('10001, Bestman, Comfort K.'), {
    studentId: '10001',
    fullName: 'Bestman, Comfort K.',
  });
});

test('a name with two commas survives intact', () => {
  // This one is in the real workbook.
  assert.deepEqual(parseRosterLine('Nagbe, S, Jonathan T.'), {
    studentId: '',
    fullName: 'Nagbe, S, Jonathan T.',
  });
});

test('a name with no separator at all is kept whole', () => {
  assert.deepEqual(parseRosterLine('Freeman Mercy'), {
    studentId: '',
    fullName: 'Freeman Mercy',
  });
});

test('surrounding whitespace is trimmed from both parts', () => {
  assert.deepEqual(parseRosterLine('  10001 \t  Cooper, Grace A.  '), {
    studentId: '10001',
    fullName: 'Cooper, Grace A.',
  });
});

test('a surname that happens to contain a digit is not mistaken for an ID', () => {
  // "Smith 2nd, John" has a digit but also a space, so it is a name.
  assert.deepEqual(parseRosterLine('Smith 2nd, John'), {
    studentId: '',
    fullName: 'Smith 2nd, John',
  });
});

test('every name in the real workbook round-trips through a tab paste', async () => {
  const { loadWorkbook } = require('./workbook-fixture');
  const sections = await loadWorkbook();
  const mangled = [];
  for (const section of sections) {
    for (const s of section.students) {
      const line = `${s.studentId ?? ''}\t${s.fullName}`;
      const parsed = parseRosterLine(line);
      if (parsed.fullName !== s.fullName) {
        mangled.push(`"${s.fullName}" became "${parsed.fullName}"`);
      }
    }
  }
  assert.deepEqual(mangled, [], `${mangled.length} name(s) mangled by the paste parser`);
});

test('a pasted block skips blank lines and parses each row', () => {
  const block = [
    '10001\tBestman, Comfort K.',
    '',
    '   ',
    '10002\tBestman, Daniel T.',
    '',
  ].join('\n');
  const rows = parseRosterText(block);
  assert.equal(rows.length, 2, 'blank and whitespace-only lines are skipped');
  assert.deepEqual(rows[0], { studentId: '10001', fullName: 'Bestman, Comfort K.' });
  assert.deepEqual(rows[1], { studentId: '10002', fullName: 'Bestman, Daniel T.' });
});

test('a block pasted with Windows line endings parses the same', () => {
  const rows = parseRosterText('10001\tBestman, Comfort K.\r\n10002\tBestman, Daniel T.\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, 'Bestman, Comfort K.');
});
