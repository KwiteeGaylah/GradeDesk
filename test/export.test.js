'use strict';
/**
 * Export tests.
 *
 * These write real .xlsx files, reopen them with a fresh reader, and assert the
 * values are what an instructor would submit. "It opens and reads correctly"
 * is the actual requirement, so the tests round-trip rather than inspecting the
 * in-memory workbook.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const { Store } = require('../src/data/store');
const { computeCourse } = require('../src/data/gradebook');
const {
  exportGradeRecord,
  exportSummary,
  exportRosterTemplate,
} = require('../src/export/excel');
const { TransmutationTables } = require('../src/engine');

const tables = new TransmutationTables(require('../data/transmutation_tables.json'));

let tmpDir;
test.before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-export-'));
});
test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A course with two students, one of whom has a blank final exam. */
function seed() {
  const store = new Store(':memory:');
  const semester = store.createSemester('2026–2027 Semester 1');
  const course = store.createCourse({
    semesterId: semester.id,
    code: 'CSE 102',
    name: 'Computer Literacy',
    section: '2',
    instructor: 'K. Gaylah',
    policy: '70',
  });
  const { byKind } = store.getTerms(course.id);
  const a = {
    midAssign: store.addAssessment(byKind.midterm.id, { name: 'Assign 1', maxPoints: 10 }),
    midQuiz1: store.addAssessment(byKind.midterm.id, { name: 'Quiz 1', maxPoints: 15 }),
    midExam: store.getExam(byKind.midterm.id),
    finQuiz3: store.addAssessment(byKind.final.id, { name: 'Quiz 3', maxPoints: 15 }),
    finProject: store.addAssessment(byKind.final.id, { name: 'Project', maxPoints: 25 }),
    finExam: store.getExam(byKind.final.id),
  };
  const [alice, bob] = store.addStudents(course.id, [
    { studentId: '10001', fullName: 'Bestman, Comfort K.' },
    { studentId: '10007', fullName: 'Karnga, Esther' },
  ]);
  store.setScore(alice.id, a.midAssign.id, 10);
  store.setScore(alice.id, a.midQuiz1.id, 11);
  store.setScore(alice.id, a.midExam.id, 31);
  store.setScore(alice.id, a.finQuiz3.id, 15);
  store.setScore(alice.id, a.finProject.id, 23);
  store.setScore(alice.id, a.finExam.id, 35);

  store.setScore(bob.id, a.midAssign.id, 8);
  store.setScore(bob.id, a.midQuiz1.id, 9);
  store.setScore(bob.id, a.midExam.id, 25);
  store.setScore(bob.id, a.finQuiz3.id, 10);
  // Bob's final exam is left blank -> letter I.

  return { store, course, students: { alice, bob }, a };
}

async function readBack(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

/**
 * Locate the header row by looking for the "Last Name" cell, rather than
 * hardcoding a row number that shifts whenever the title block changes.
 */
function headerRowOf(ws) {
  for (let r = 1; r <= 12; r++) {
    let found = false;
    ws.getRow(r).eachCell((cell) => {
      if (String(cell.value ?? '').trim() === 'Last Name') found = true;
    });
    if (found) return r;
  }
  throw new Error('could not find the header row in the exported sheet');
}

/** Find the row holding a student's name, and return values by header. */
function rowFor(ws, headerRow, name) {
  const headers = {};
  ws.getRow(headerRow).eachCell((cell, col) => {
    headers[col] = String(cell.value ?? '');
  });
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values = {};
    let match = false;
    row.eachCell((cell, col) => {
      values[headers[col]] = cell.value;
      if (String(cell.value ?? '').trim() === name) match = true;
    });
    if (match) return values;
  }
  return null;
}

test('the grade record writes a file that reopens cleanly', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  assert.ok(fs.existsSync(file));
  assert.ok(fs.statSync(file).size > 0);
  const wb = await readBack(file);
  assert.ok(wb.worksheets.length >= 1);
  store.close();
});

test('the grade record carries the university title and course details', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-title.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  // Row 1 is the banner; rows 2 and 3 hold label/value pairs, value in col 2.
  assert.match(String(ws.getCell(1, 1).value), /William V\.S\. Tubman University/);
  assert.equal(ws.getCell(2, 1).value, 'Course Code:');
  assert.match(String(ws.getCell(2, 2).value), /CSE 102/);
  assert.equal(ws.getCell(3, 2).value, 'Computer Literacy');

  // The detail pairs are placed relative to the identity block, which widened
  // when names were split into columns, so they are found by their label
  // rather than by a fixed position.
  const labelled = (row, label) => {
    for (let c = 1; c <= 20; c += 1) {
      if (String(ws.getCell(row, c).value ?? '').trim() === label) {
        return ws.getCell(row, c + 1).value;
      }
    }
    return null;
  };
  assert.ok(labelled(2, 'Instructor:') !== null, 'the instructor pair is on row 2');
  assert.equal(labelled(3, 'Policy:'), '70% transmutation');
  store.close();
});

test('the exported final grade is exactly two decimals and never rounded up', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-grades.xlsx');
  const result = computeCourse(store, course.id, tables);
  await exportGradeRecord(result, file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const row = rowFor(ws, headerRowOf(ws), 'Bestman');
  assert.ok(row, 'the student should appear in the export');

  const exported = String(row['Final Grade']);
  const computed = result.students.find((r) => r.student.full_name === 'Bestman, Comfort K.');
  assert.match(exported, /^\d+\.\d{2}$/, `"${exported}" should be two decimals`);
  assert.equal(exported, computed.finalGradeDisplay);
  // Written as text precisely so a number format cannot round it up on display.
  assert.equal(typeof row['Final Grade'], 'string');
  store.close();
});

test('a blank exam exports the letter I', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-incomplete.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const row = rowFor(wb.worksheets[0], headerRowOf(wb.worksheets[0]), 'Karnga');
  assert.equal(row['Letter Grade'], 'I');
  store.close();
});

test('a blank raw score exports as blank, not as zero', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-blank.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const row = rowFor(wb.worksheets[0], headerRowOf(wb.worksheets[0]), 'Karnga');
  // Bob's Project was never entered.
  assert.ok(
    row['Project'] === null || row['Project'] === undefined || row['Project'] === '',
    `blank should stay blank, got ${JSON.stringify(row['Project'])}`
  );
  // But its transmuted value is a real 50 and must be shown.
  assert.equal(row['Transmuted'] !== undefined, true);
  store.close();
});

test('every assessment appears with its own transmuted column', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-columns.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const headers = [];
  ws.getRow(headerRowOf(ws)).eachCell((cell) => headers.push(String(cell.value ?? '')));

  for (const name of ['Assign 1', 'Quiz 1', 'Midterm Exam', 'Quiz 3', 'Project', 'Final Exam']) {
    assert.ok(headers.includes(name), `missing column "${name}"`);
  }
  assert.ok(headers.includes('Class Standing'));
  assert.ok(headers.includes('Total Mid-term Marks'));
  assert.ok(headers.includes('Total Final-term'));
  assert.ok(headers.includes('Final Grade'));
  assert.ok(headers.includes('Letter Grade'));
  // One transmuted column per assessment, exam included: 3 midterm + 3 final.
  assert.equal(headers.filter((h) => h === 'Transmuted').length, 6);
  store.close();
});

test('the grade record includes a summary sheet alongside it', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-with-summary.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const names = wb.worksheets.map((w) => w.name);
  assert.ok(names.includes('Summary'), `expected a Summary sheet, got ${names.join(', ')}`);
  store.close();
});

test('the summary export holds ID, name, final grade and letter only', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'summary.xlsx');
  const result = computeCourse(store, course.id, tables);
  await exportSummary(result, file);

  const wb = await readBack(file);
  assert.equal(wb.worksheets.length, 1);
  const ws = wb.worksheets[0];

  const headers = [];
  ws.getRow(headerRowOf(ws)).eachCell((cell) => headers.push(String(cell.value ?? '')));
  // The identity block is the administration's four columns, then the joined
  // name, so the summary can be handed back in the format it was issued in.
  assert.deepEqual(headers, [
    'No.', 'Student ID', 'Last Name', 'First Name', 'Middle Name',
    'Final Grade', 'Letter Grade',
  ]);

  const row = rowFor(ws, headerRowOf(ws), 'Bestman');
  assert.equal(row['Student ID'], '10001');
  assert.equal(row['Last Name'], 'Bestman');
  assert.equal(row['First Name'], 'Comfort');
  assert.equal(row['Middle Name'], 'K.');
  assert.equal(
    row['Final Grade'],
    result.students.find((r) => r.student.full_name === 'Bestman, Comfort K.').finalGradeDisplay
  );
  store.close();
});

test('an archived semester still exports', async () => {
  const { store, course } = seed();
  // Archive it by creating and activating a newer semester.
  store.createSemester('2027–2028 Semester 1');
  assert.equal(store.getCourse(course.id) !== null, true);

  const file = path.join(tmpDir, 'archived.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);
  const wb = await readBack(file);
  assert.ok(rowFor(wb.worksheets[0], headerRowOf(wb.worksheets[0]), 'Bestman'));
  store.close();
});

test('the section is not repeated when the code already names it', async () => {
  const store = new Store(':memory:');
  const semester = store.createSemester('S1');
  // The instructor typed the section into the code as well, as in the real file.
  const course = store.createCourse({
    semesterId: semester.id,
    code: 'CSE 102 Sec. 2',
    name: 'Computer Literacy',
    section: '2',
  });
  const file = path.join(tmpDir, 'label.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  assert.equal(wb.worksheets[0].name, 'CSE 102 Sec. 2', 'sheet name should not repeat the section');
  assert.equal(wb.worksheets[0].getCell(2, 2).value, 'CSE 102 Sec. 2');
  store.close();
});

test('the section is appended when the code omits it', async () => {
  const store = new Store(':memory:');
  const semester = store.createSemester('S1');
  const course = store.createCourse({ semesterId: semester.id, code: 'CSE 102', section: '11' });
  const file = path.join(tmpDir, 'label2.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  assert.equal(wb.worksheets[0].getCell(2, 2).value, 'CSE 102 Sec. 11');
  store.close();
});

test('a course with no students still produces a valid file', async () => {
  const store = new Store(':memory:');
  const semester = store.createSemester('S1');
  const course = store.createCourse({ semesterId: semester.id, code: 'EMPTY 101' });
  const file = path.join(tmpDir, 'empty.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  assert.match(String(wb.worksheets[0].getCell(1, 1).value), /Tubman University/);
  store.close();
});

test('the export follows the workbook layout: banner, weights, coloured columns', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-design.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const argb = (r, c) => {
    const f = ws.getCell(r, c).fill;
    return (f && f.fgColor && f.fgColor.argb) || null;
  };
  const hr = headerRowOf(ws);
  const cols = {};
  ws.getRow(hr).eachCell((cell, col) => { cols[String(cell.value ?? '')] = col; });

  // The blue term banner sits two rows above the headers, the weights one
  // above. It starts at the first score column, wherever the identity block
  // happens to end.
  // "Assign 1" is the seed's first midterm assessment, so it is the first
  // column of the Mid-Term banner. (cols['Class Standing'] appears twice, once
  // per term, so the later one wins and would point at the final term.)
  const firstScoreCol = cols['Assign 1'];
  assert.ok(firstScoreCol, 'the sheet should have the first midterm column');
  assert.equal(argb(hr - 2, firstScoreCol), 'FF2F75B5', 'term banner should be blue');
  assert.match(String(ws.getCell(hr - 2, firstScoreCol).value), /Mid-Term/);
  assert.match(String(ws.getCell(hr - 1, cols['Class Standing']).value), /%$/, 'weight row shows a percentage');

  // Column colours match the instructor's own sheet.
  assert.equal(argb(hr, cols.Transmuted), 'FFFFC000', 'transmuted columns are orange');
  assert.equal(argb(hr, cols['Class Standing']), 'FFC6EFCE', 'class standing is green');
  assert.equal(argb(hr, cols['Midterm Exam']), 'FFFFC7CE', 'the exam column is pink');
  assert.equal(argb(hr + 1, cols['Final Grade']), 'FFC6EFCE', 'the final grade is green');
  store.close();
});

test('a student not on the official roster is highlighted in the export', async () => {
  const { store, course, students } = seed();
  store.updateStudent(students.alice.id, { unofficial: 1, note: 'addendum expected' });

  const file = path.join(tmpDir, 'record-flagged.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const hr = headerRowOf(ws);
  let nameCol = null;
  ws.getRow(hr).eachCell((cell, col) => {
    if (String(cell.value ?? '').trim() === 'Last Name') nameCol = col;
  });
  assert.ok(nameCol, 'the sheet should have a Last Name column');

  let row = null;
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    if (String(ws.getRow(r).getCell(nameCol).value ?? '').trim() === 'Bestman') {
      row = r;
      break;
    }
  }
  assert.ok(row, 'the flagged student should be in the sheet');
  const fill = ws.getCell(row, nameCol).fill;
  assert.equal(fill && fill.fgColor && fill.fgColor.argb, 'FFFFF2CC', 'their name cell is highlighted');
  assert.match(String(ws.getCell(row, nameCol).note || ''), /addendum expected/, 'the note is attached');
  store.close();
});

test('attendance exports with readable dates and a score', async () => {
  const { store, course, students } = seed();
  const { byKind } = store.getTerms(course.id);
  const att = store.addAssessment(byKind.midterm.id, {
    name: 'Attendance', maxPoints: 10, kind: 'attendance',
  });
  const s1 = store.addSession(course.id, byKind.midterm.id, '2026-09-02');
  const s2 = store.addSession(course.id, byKind.midterm.id, '2026-09-09');
  store.setMark(students.alice.id, s1.id, 'P');
  store.setMark(students.alice.id, s2.id, 'E');
  store.setMark(students.bob.id, s1.id, 'A');
  store.setMark(students.bob.id, s2.id, 'P');

  const { exportAttendance } = require('../src/export/excel');
  const result = computeCourse(store, course.id, tables);
  const { sessions, byStudent } = store.getMarksForTerm(byKind.midterm.id);
  const file = path.join(tmpDir, 'attendance.xlsx');
  await exportAttendance(result, { midterm: { sessions, marks: byStudent } }, file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  assert.match(ws.name, /Attendance/);
  assert.match(String(ws.getCell(1, 1).value), /Attendance/);

  const headers = [];
  ws.getRow(5).eachCell((c) => headers.push(String(c.value ?? '')));
  assert.ok(headers.includes('Sept. 2, 2026'), `dates should read plainly: ${headers.join(', ')}`);
  assert.ok(headers.includes('Sept. 9, 2026'));
  assert.ok(headers.some((h) => /Score \/10/.test(h)));

  // Alice: one P and one E over two sessions is 7.5, recorded as 8.
  const row = rowFor(ws, 5, 'Bestman');
  assert.equal(row['Sept. 2, 2026'], 'P');
  assert.equal(row['Sept. 9, 2026'], 'E');
  assert.equal(row['Score /10'], 8);
  store.close();
});

test('exporting attendance with no sessions says so rather than writing an empty file', async () => {
  const { store, course } = seed();
  const { exportAttendance } = require('../src/export/excel');
  const result = computeCourse(store, course.id, tables);
  await assert.rejects(
    () => exportAttendance(result, {}, path.join(tmpDir, 'empty-att.xlsx')),
    /no attendance sessions/i
  );
  store.close();
});

// ------------------------------------------------- the class list template

/**
 * The sample workbook an instructor downloads, fills in, and pastes back.
 *
 * Its whole job is to teach one thing — the four columns, in the
 * administration's order — so the test holds it to exactly that: the headings
 * are right, the guidance sits ABOVE them (so the block from the header down
 * can be selected and copied without dragging instructions along), and the
 * example rows parse back through the real paste parser.
 */
test('the class list template offers the four official columns in order', async () => {
  const file = path.join(tmpDir, 'template.xlsx');
  await exportRosterTemplate(file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];

  let headerRow = null;
  for (let r = 1; r <= 12; r += 1) {
    if (String(ws.getCell(r, 1).value ?? '').trim() === 'Student ID') {
      headerRow = r;
      break;
    }
  }
  assert.ok(headerRow, 'the template should have a Student ID heading');

  const headers = [1, 2, 3, 4].map((c) => String(ws.getCell(headerRow, c).value ?? '').trim());
  assert.deepEqual(headers, ['Student ID', 'Last Name', 'First Name', 'Middle Name']);
  assert.equal(String(ws.getCell(headerRow, 5).value ?? ''), '', 'and no fifth column');
});

test('the template warns, in the file itself, that the order must be kept', async () => {
  const file = path.join(tmpDir, 'template-warning.xlsx');
  await exportRosterTemplate(file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];

  let text = '';
  for (let r = 1; r <= 5; r += 1) {
    for (let c = 1; c <= 4; c += 1) text += ` ${ws.getCell(r, c).value ?? ''}`;
  }
  assert.match(text, /do not add, remove, rename or reorder/i, 'the rule is stated plainly');
  assert.match(text, /paste/i, 'and it says what to do with the file');
});

test('the template guidance sits above the headings, never below them', async () => {
  const file = path.join(tmpDir, 'template-layout.xlsx');
  await exportRosterTemplate(file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];

  let headerRow = null;
  for (let r = 1; r <= 12; r += 1) {
    if (String(ws.getCell(r, 1).value ?? '').trim() === 'Student ID') headerRow = r;
  }

  // Everything from the row under the headings down is data: student rows and
  // blanks, and nothing that would be pasted in by mistake.
  for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
    const first = String(ws.getCell(r, 1).value ?? '').trim();
    assert.ok(
      first === '' || /^[\w-]+$/.test(first),
      `row ${r} under the headings should be a student row, found "${first}"`
    );
  }
});

test('the template example rows parse back through the real paste parser', async () => {
  const { parseRosterLine } = require('../src/engine');
  const file = path.join(tmpDir, 'template-examples.xlsx');
  await exportRosterTemplate(file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];

  let headerRow = null;
  for (let r = 1; r <= 12; r += 1) {
    if (String(ws.getCell(r, 1).value ?? '').trim() === 'Student ID') headerRow = r;
  }

  // The first example, read back the way a copy-paste out of Excel would
  // deliver it: one tab between each column.
  const cells = [1, 2, 3, 4].map((c) => String(ws.getCell(headerRow + 1, c).value ?? ''));
  assert.ok(cells[0], 'the first example row should have an ID');

  const parsed = parseRosterLine(cells.join('	'));
  assert.equal(parsed.studentId, cells[0]);
  assert.equal(parsed.lastName, cells[1]);
  assert.equal(parsed.firstName, cells[2]);
  assert.equal(parsed.middleName, cells[3]);
});

test('student IDs in the template are text, so leading zeros survive', async () => {
  const file = path.join(tmpDir, 'template-idformat.xlsx');
  await exportRosterTemplate(file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  assert.equal(ws.getColumn(1).numFmt, '@', 'the ID column is formatted as text');
});

// ------------------ a 20-point assessment in the exports -------------------

/**
 * The 70% table's 20-point column is reconstructed rather than transcribed, so
 * these check it travels through the export layer like any other column: right
 * value, right tint, counted in the weight row, and consistent between the
 * grade record and the summary. A teacher reported not being able to set 20
 * points at all; the export is where that grade is actually submitted from.
 */
function seed20() {
  const store = new Store(':memory:');
  const semester = store.createSemester('2026–2027 Semester 1');
  const course = store.createCourse({
    semesterId: semester.id, code: 'CSE 102', name: 'Computer Literacy',
    section: '2', instructor: 'K. Gaylah', policy: '70',
  });
  const { byKind } = store.getTerms(course.id);
  const project = store.addAssessment(byKind.midterm.id, { name: 'Midterm Project', maxPoints: 20 });
  const quiz = store.addAssessment(byKind.midterm.id, { name: 'Quiz 1', maxPoints: 15 });
  store.addAssessment(byKind.final.id, { name: 'Final Project', maxPoints: 20 });
  const student = store.addStudent(course.id, {
    studentId: '10001', lastName: 'Bestman', firstName: 'Comfort', middleName: 'K.',
  });
  store.setScore(student.id, project.id, 17);
  store.setScore(student.id, quiz.id, 12);
  store.setScore(student.id, store.getExam(byKind.midterm.id).id, 33);
  store.setScore(student.id, store.getExam(byKind.final.id).id, 36);
  return { store, course, project, quiz };
}

/** Column index of the nth header with this exact text. */
function colOf(ws, headerRow, text, nth = 1) {
  let seen = 0;
  let found = null;
  ws.getRow(headerRow).eachCell((cell, col) => {
    if (String(cell.value ?? '').trim() === text) {
      seen += 1;
      if (seen === nth) found = col;
    }
  });
  return found;
}

test('a 20-point assessment exports its raw score and transmuted value', async () => {
  const { store, course } = seed20();
  const file = path.join(tmpDir, 'record-20pt.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const hr = headerRowOf(ws);
  const rawCol = colOf(ws, hr, 'Midterm Project');
  assert.ok(rawCol, 'the 20-point assessment should have a column');

  assert.equal(ws.getCell(hr + 1, rawCol).value, 17, 'the raw score is exported as typed');
  // 17 of 20 under the 70% table. Taken from the engine rather than restated, so
  // this tracks the table instead of freezing a copy of it.
  const expected = tables.transmute(17, 20, '70');
  assert.equal(ws.getCell(hr + 1, rawCol + 1).value, expected,
    `17/20 should transmute to ${expected}`);
  assert.ok(expected > 50 && expected < 100, 'and be a real interior value');
  store.close();
});

test('the 20-point column is tinted and weighted like every other one', async () => {
  const { store, course } = seed20();
  const file = path.join(tmpDir, 'record-20pt-style.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const hr = headerRowOf(ws);
  const argb = (r, c) => {
    const f = ws.getCell(r, c).fill;
    return (f && f.fgColor && f.fgColor.argb) || null;
  };
  const twenty = colOf(ws, hr, 'Midterm Project');
  const fifteen = colOf(ws, hr, 'Quiz 1');

  // Its transmuted column is orange, exactly as the 15-point one beside it.
  assert.equal(argb(hr, twenty + 1), argb(hr, fifteen + 1),
    'the transmuted header should be tinted the same');
  assert.equal(argb(hr, twenty + 1), 'FFFFC000', 'and that tint is the workbook orange');

  // It carries a share of the 60%: two class-standing assessments, so 30% each.
  assert.equal(ws.getCell(hr - 1, twenty).value, ws.getCell(hr - 1, fifteen).value,
    'both assessments carry an equal share of class standing');
  assert.match(String(ws.getCell(hr - 1, twenty).value), /%$/);
  store.close();
});

test('the summary agrees with the grade record for a 20-point course', async () => {
  const { store, course } = seed20();
  const result = computeCourse(store, course.id, tables);
  const summaryFile = path.join(tmpDir, 'summary-20pt.xlsx');
  await exportSummary(result, summaryFile);

  const wb = await readBack(summaryFile);
  const ws = wb.worksheets[0];
  const row = rowFor(ws, headerRowOf(ws), 'Bestman');
  // The two sheets must never disagree: both render the same computed result.
  assert.equal(row['Final Grade'], result.students[0].finalGradeDisplay);
  assert.equal(row['Letter Grade'], result.students[0].letter);
  assert.equal(row['Student ID'], '10001');
  store.close();
});

test('an unusable assessment exports a blank transmuted cell, not a made-up number', async () => {
  // The companion fault: a point value with no column used to throw and take the
  // whole export down with it. Now the raw score is kept, its transmuted cell is
  // blank, and every other column still exports.
  const store = new Store(':memory:');
  const semester = store.createSemester('2026–2027 Semester 1');
  const course = store.createCourse({
    semesterId: semester.id, code: 'CSE 102', name: 'Computer Literacy', policy: '70',
  });
  const { byKind } = store.getTerms(course.id);
  const bad = store.addAssessment(byKind.midterm.id, { name: 'Portfolio', maxPoints: 17 });
  const good = store.addAssessment(byKind.midterm.id, { name: 'Quiz 1', maxPoints: 20 });
  store.addAssessment(byKind.final.id, { name: 'Quiz 2', maxPoints: 10 });
  const student = store.addStudent(course.id, {
    studentId: '10001', lastName: 'Doe', firstName: 'Jane',
  });
  store.setScore(student.id, bad.id, 12);
  store.setScore(student.id, good.id, 17);

  const file = path.join(tmpDir, 'record-unusable.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const hr = headerRowOf(ws);
  const badCol = colOf(ws, hr, 'Portfolio');
  const goodCol = colOf(ws, hr, 'Quiz 1');

  assert.equal(ws.getCell(hr + 1, badCol).value, 12, 'the raw score is not lost');
  assert.equal(ws.getCell(hr + 1, badCol + 1).value, null,
    'its transmuted cell is blank rather than invented');
  assert.equal(ws.getCell(hr + 1, goodCol + 1).value, tables.transmute(17, 20, '70'),
    'and the 20-point assessment beside it is unaffected');
  store.close();
});
