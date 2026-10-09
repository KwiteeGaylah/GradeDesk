'use strict';
/**
 * Importing the class roster PDF.
 *
 * The roster comes from Smart School Online, printed to PDF. Its text is read
 * by POSITION, because reading it in stored order paired a real middle name
 * with the student above it on page 2 — a mistake that looks perfectly
 * plausible on screen. These tests lay text out the way that PDF does and check
 * every word lands in the right row and column.
 *
 * Every name and ID here is invented. Real class lists never go in the
 * repository.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseRosterPdf, rosterCourseCheck, planRosterImport } = require('../src/engine');
const { Store } = require('../src/data/store');
const { readPdfText } = require('../src/import/pdf');
const {
  X, ROW, item, firstPage, laterPage, PAGE_ONE, PAGE_TWO, writeRosterPdf,
} = require('./pdf-fixture');

// ------------------------------------------------------------------ parsing

test('every student is read, in order, across both pages', () => {
  const { rows, problems } = parseRosterPdf([firstPage(PAGE_ONE), laterPage(PAGE_TWO)]);
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => r.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(
    rows.map((r) => [r.studentId, r.lastName, r.firstName, r.middleName]),
    [
      ['TU-90001', 'Bestman', 'Comfort', 'K.'],
      ['TU-90002', 'Doe, Jr.', 'Marcus', 'E.'],
      ['80003', 'Dolo', 'Patience', ''],
      ['TU-90004', 'Flomo', 'Esther', 'Otis D.W.'],
      ['TU-90005', 'Kollie', 'James', 'T.'],
      ['80006', 'Kollie', 'Martha', ''],
      ['TU-90007', 'Wleh', 'Sarah', 'Deodor'],
    ]
  );
});

test('a middle name stays on its own row when the student above has none', () => {
  // The exact case that went wrong when the text was read in stored order:
  // a student with no middle name directly above one who has a middle name.
  const { rows } = parseRosterPdf([firstPage(PAGE_ONE), laterPage(PAGE_TWO)]);
  assert.equal(rows.find((r) => r.firstName === 'Martha').middleName, '');
  assert.equal(rows.find((r) => r.firstName === 'Sarah').middleName, 'Deodor');
});

test('the course details printed above the table are read', () => {
  const { meta } = parseRosterPdf([firstPage(PAGE_ONE)]);
  assert.deepEqual(meta, {
    section: '7',
    semester: '2026/2027 Sem. 1',
    courseCode: 'CSE',
    courseNumber: '101',
    description: 'Introduction to Computers',
  });
});

test('a suffix stays in the surname exactly as printed', () => {
  const { rows } = parseRosterPdf([firstPage(PAGE_ONE)]);
  const doe = rows.find((r) => r.studentId === 'TU-90002');
  assert.equal(doe.lastName, 'Doe, Jr.');
  assert.equal(doe.fullName, 'Doe, Jr., Marcus E.');
});

test('a stray comma after an initial is tidied, and the row says so', () => {
  const { rows } = parseRosterPdf([firstPage(PAGE_ONE)]);
  const doe = rows.find((r) => r.studentId === 'TU-90002');
  assert.equal(doe.middleName, 'E.');
  assert.deepEqual(doe.notes, ['Middle name "E," read as "E."']);
  // Nobody else is flagged.
  assert.equal(rows.filter((r) => r.notes.length).length, 1);
});

test('email and phone numbers are never read into a row', () => {
  const { rows } = parseRosterPdf([firstPage(PAGE_ONE), laterPage(PAGE_TWO)]);
  const text = JSON.stringify(rows);
  assert.ok(!text.includes('@'), 'no email address');
  assert.ok(!text.includes('0770000000'), 'no phone number');
  for (const row of rows) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['firstName', 'fullName', 'lastName', 'middleName', 'notes', 'number', 'studentId']
    );
  }
});

test('the footer and page furniture are not students', () => {
  const { rows, problems } = parseRosterPdf([firstPage(PAGE_ONE), laterPage(PAGE_TWO)]);
  assert.equal(rows.length, 7);
  assert.deepEqual(problems, []);
});

test('a page without its own heading row carries on with the columns before it', () => {
  const { rows } = parseRosterPdf([firstPage(PAGE_ONE), laterPage(PAGE_TWO, { heading: false })]);
  assert.equal(rows.length, 7);
  assert.equal(rows[6].middleName, 'Deodor');
});

test('a heading stored as two pieces of text is still recognised', () => {
  const page = firstPage(PAGE_ONE).flatMap((it) => {
    if (it.str !== 'Last Name') return [it];
    return [
      { ...it, str: 'Last', width: 22 },
      { ...it, str: 'Name', x: it.x + 25, width: 30 },
    ];
  });
  const { rows } = parseRosterPdf([page]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].lastName, 'Bestman');
});

test('a name that wraps onto a second line joins the row above', () => {
  const page = firstPage(PAGE_ONE);
  // Squeeze a continuation in just under row 1, half a row down.
  page.push(item('Tarr', X.middle, 323 + 11));
  const { rows } = parseRosterPdf([page]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].middleName, 'K. Tarr');
});

test('a student line with no row number is reported, not dropped quietly', () => {
  const page = firstPage(PAGE_ONE);
  const y = 323 + PAGE_ONE.length * ROW;
  page.push(item('TU-90099', X.id, y), item('Gaye', X.last, y), item('Musu', X.first, y));
  const { rows, problems } = parseRosterPdf([page]);
  assert.equal(rows.length, 4);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Page 1: .*TU-90099 Gaye Musu/);
});

test('a PDF with no text, or no class list, is told apart', () => {
  assert.deepEqual(
    (({ hasText, foundTable }) => ({ hasText, foundTable }))(parseRosterPdf([[], []])),
    { hasText: false, foundTable: false }
  );
  const letter = parseRosterPdf([[item('Dear colleague,', 44, 100), item('Regards', 44, 200)]]);
  assert.equal(letter.hasText, true);
  assert.equal(letter.foundTable, false);
  assert.equal(letter.rows.length, 0);
});

// ----------------------------------------------------- is it this course?

test('the course check ignores spacing, case and leading zeros', () => {
  const meta = { courseCode: 'CSE', courseNumber: '101', section: '04' };
  assert.equal(rosterCourseCheck(meta, { code: 'cse101', section: '4' }).matches, true);
  assert.equal(rosterCourseCheck(meta, { code: 'CSE 101', section: 'Section 4' }).matches, true);
});

test('a different section or course is flagged, with both labels to show', () => {
  const meta = { courseCode: 'CSE', courseNumber: '101', section: '4' };
  assert.deepEqual(rosterCourseCheck(meta, { code: 'CSE 101', section: '12' }), {
    matches: false,
    codeMatches: true,
    sectionMatches: false,
    pdfLabel: 'CSE 101 · Section 4',
    courseLabel: 'CSE 101 · Section 12',
  });
  assert.equal(rosterCourseCheck(meta, { code: 'CSENG 301', section: '4' }).codeMatches, false);
});

test('a course with no section set is not flagged for the section', () => {
  const meta = { courseCode: 'CSE', courseNumber: '101', section: '4' };
  assert.equal(rosterCourseCheck(meta, { code: 'CSE 101', section: '' }).matches, true);
});

test('a PDF that names no course is not checked at all', () => {
  assert.equal(rosterCourseCheck({}, { code: 'CSE 101', section: '4' }), null);
});

// ------------------------------------------------- where students go

const stored = (id, studentId = '', last = '', first = '', extra = {}) => ({
  id, number: id, student_id: studentId, last_name: last, first_name: first,
  middle_name: '', full_name: last && first ? `${last}, ${first}` : last, hasWork: false, ...extra,
});
const incoming = (studentId, lastName, firstName) => ({ studentId, lastName, firstName, middleName: '' });

test('empty rows are filled first, in order, and the rest are added after', () => {
  const plan = planRosterImport(
    [stored(1), stored(2)],
    [incoming('A1', 'Bestman', 'Comfort'), incoming('A2', 'Dolo', 'Patience'), incoming('A3', 'Flomo', 'Esther')]
  );
  assert.deepEqual(plan.fill.map((f) => [f.student.id, f.row.studentId]), [[1, 'A1'], [2, 'A2']]);
  assert.deepEqual(plan.add.map((r) => r.studentId), ['A3']);
  assert.deepEqual(plan.skip, []);
});

test('an empty row with a score or mark on it is never filled', () => {
  const plan = planRosterImport(
    [stored(1, '', '', '', { hasWork: true }), stored(2)],
    [incoming('A1', 'Bestman', 'Comfort'), incoming('A2', 'Dolo', 'Patience')]
  );
  assert.deepEqual(plan.fill.map((f) => f.student.id), [2]);
  assert.deepEqual(plan.add.map((r) => r.studentId), ['A2']);
});

test('a student already in the course is skipped, matching the ID loosely', () => {
  const plan = planRosterImport(
    [stored(1, 'tu-90001', 'Bestman', 'Comfort')],
    [incoming('TU-90001', 'Bestman', 'Comfort'), incoming('TU-90002', 'Dolo', 'Patience')]
  );
  assert.deepEqual(plan.add.map((r) => r.studentId), ['TU-90002']);
  assert.equal(plan.skip.length, 1);
  assert.equal(plan.skip[0].reason, 'Already on your list as Bestman, Comfort');
});

test('without an ID, a student is matched by last and first name', () => {
  const plan = planRosterImport(
    [stored(1, '', 'Bestman', 'Comfort')],
    [incoming('', 'BESTMAN', 'comfort'), incoming('', 'Dolo', 'Patience')]
  );
  assert.deepEqual(plan.add.map((r) => r.lastName), ['Dolo']);
  assert.equal(plan.skip.length, 1);
});

test('the same student twice on one PDF is added once', () => {
  const plan = planRosterImport([], [incoming('A1', 'Bestman', 'Comfort'), incoming('a1', 'Bestman', 'Comfort')]);
  assert.equal(plan.add.length, 1);
  assert.deepEqual(plan.skip.map((s) => s.reason), ['Listed twice on this PDF']);
});

// ------------------------------------------------------------- the store

function courseWithEmptyRows(count) {
  const store = new Store(':memory:');
  const semester = store.createSemester('2026–2027 Semester 1');
  const course = store.createCourse({ semesterId: semester.id, code: 'CSE 101', section: '7' });
  store.addStudents(course.id, Array.from({ length: count }, () => ({})));
  return { store, course };
}

test('importing fills the empty rows, adds the rest, and keeps names whole', () => {
  const { store, course } = courseWithEmptyRows(3);
  const { rows } = parseRosterPdf([firstPage(PAGE_ONE), laterPage(PAGE_TWO)]);
  const done = store.importRoster(course.id, rows);
  assert.deepEqual(done, { filled: 3, added: 4, skipped: 0 });

  const list = store.listStudents(course.id);
  assert.equal(list.length, 7, 'no empty rows left behind');
  assert.deepEqual(list.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(list[1].last_name, 'Doe, Jr.');
  assert.equal(list[1].full_name, 'Doe, Jr., Marcus E.');
  assert.equal(list[6].middle_name, 'Deodor');
});

test('importing the same PDF twice adds nobody the second time', () => {
  const { store, course } = courseWithEmptyRows(0);
  const { rows } = parseRosterPdf([firstPage(PAGE_ONE), laterPage(PAGE_TWO)]);
  store.importRoster(course.id, rows);
  assert.deepEqual(store.importRoster(course.id, rows), { filled: 0, added: 0, skipped: 7 });
  assert.equal(store.listStudents(course.id).length, 7);
});

test('an empty row with a score already typed against it keeps its score and stays empty', () => {
  const { store, course } = courseWithEmptyRows(2);
  const [first] = store.listStudents(course.id);
  const { byKind } = store.getTerms(course.id);
  const quiz = store.addAssessment(byKind.midterm.id, { name: 'Quiz 1', maxPoints: 10 });
  store.setScore(first.id, quiz.id, 8);

  store.importRoster(course.id, parseRosterPdf([firstPage(PAGE_ONE)]).rows);
  const kept = store.getStudent(first.id);
  assert.equal(kept.last_name, '', 'not given someone else’s name');
  assert.equal(store.listStudents(course.id).length, 1 + 4);
});

// ------------------------------------------------- reading a real PDF file

test('a real PDF file is read from disk and parsed into the same rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-pdf-'));
  const file = path.join(dir, 'roster.pdf');
  try {
    writeRosterPdf(file);
    const pages = await readPdfText(file);
    assert.equal(pages.length, 2);
    const { rows, meta, problems } = parseRosterPdf(pages);
    assert.deepEqual(problems, []);
    assert.equal(meta.section, '7');
    assert.deepEqual(
      rows.map((r) => [r.studentId, r.lastName, r.middleName]),
      [
        ['TU-90001', 'Bestman', 'K.'],
        ['TU-90002', 'Doe, Jr.', 'E.'],
        ['80003', 'Dolo', ''],
        ['TU-90004', 'Flomo', 'Otis D.W.'],
        ['TU-90005', 'Kollie', 'T.'],
        ['80006', 'Kollie', ''],
        ['TU-90007', 'Wleh', 'Deodor'],
      ]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that is not a PDF gets a plain-English error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-pdf-'));
  const file = path.join(dir, 'not-a-roster.pdf');
  try {
    fs.writeFileSync(file, 'Student ID,Last Name\n10001,Bestman\n');
    await assert.rejects(readPdfText(file), /could not be opened as a PDF/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
