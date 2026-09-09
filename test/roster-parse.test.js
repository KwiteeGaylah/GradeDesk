'use strict';
/**
 * Roster paste parsing.
 *
 * WVSTU names are written "Surname, Given", so a comma is part of the name far
 * more often than it is a separator. An earlier version split on tabs and
 * commas together and turned "Allison, Elizabeth Y." into
 * "Allison Elizabeth Y." for every pasted row — found by driving the real app.
 *
 * The parser lives in src/engine/roster.js rather than in the renderer, so it
 * can be tested directly instead of only through the running application.
 */

const test = require('node:test');
const assert = require('node:assert');
const { parseRosterLine, parseRosterText } = require('../src/engine');

test('a tab separates the ID from a name that contains commas', () => {
  assert.deepEqual(parseRosterLine('44305\tAllison, Elizabeth Y.'), {
    studentId: '44305',
    fullName: 'Allison, Elizabeth Y.',
  });
});

test('a non-numeric ID still works with a tab', () => {
  assert.deepEqual(parseRosterLine('TU-03265\tButler, Frances E.'), {
    studentId: 'TU-03265',
    fullName: 'Butler, Frances E.',
  });
});

test('a name alone keeps its comma and is not treated as an ID', () => {
  assert.deepEqual(parseRosterLine('Allison, Elizabeth Y.'), {
    studentId: '',
    fullName: 'Allison, Elizabeth Y.',
  });
});

test('a comma separates only when the head looks like an ID', () => {
  assert.deepEqual(parseRosterLine('44305, Allison, Elizabeth Y.'), {
    studentId: '44305',
    fullName: 'Allison, Elizabeth Y.',
  });
});

test('a name with two commas survives intact', () => {
  // This one is in the real workbook.
  assert.deepEqual(parseRosterLine('Harmon, H, Jonathan S.'), {
    studentId: '',
    fullName: 'Harmon, H, Jonathan S.',
  });
});

test('a name with no separator at all is kept whole', () => {
  assert.deepEqual(parseRosterLine('Chea Catherine'), {
    studentId: '',
    fullName: 'Chea Catherine',
  });
});

test('surrounding whitespace is trimmed from both parts', () => {
  assert.deepEqual(parseRosterLine('  44305 \t  Bioh, Alice T.  '), {
    studentId: '44305',
    fullName: 'Bioh, Alice T.',
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
    '44305\tAllison, Elizabeth Y.',
    '',
    '   ',
    '38901\tAllison, Emmanuel M.',
    '',
  ].join('\n');
  const rows = parseRosterText(block);
  assert.equal(rows.length, 2, 'blank and whitespace-only lines are skipped');
  assert.deepEqual(rows[0], { studentId: '44305', fullName: 'Allison, Elizabeth Y.' });
  assert.deepEqual(rows[1], { studentId: '38901', fullName: 'Allison, Emmanuel M.' });
});

test('a block pasted with Windows line endings parses the same', () => {
  const rows = parseRosterText('44305\tAllison, Elizabeth Y.\r\n38901\tAllison, Emmanuel M.\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, 'Allison, Elizabeth Y.');
});
