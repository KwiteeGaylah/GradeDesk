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
const { exportGradeRecord, exportSummary } = require('../src/export/excel');
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
    { studentId: '44305', fullName: 'Allison, Elizabeth Y.' },
    { studentId: '36095', fullName: 'Dogbeh, Princess' },
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
 * Locate the header row by looking for the "FullName" cell, rather than
 * hardcoding a row number that shifts whenever the title block changes.
 */
function headerRowOf(ws) {
  for (let r = 1; r <= 12; r++) {
    let found = false;
    ws.getRow(r).eachCell((cell) => {
      if (String(cell.value ?? '').trim() === 'FullName') found = true;
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
  assert.equal(ws.getCell(2, 5).value, 'Instructor:');
  assert.equal(ws.getCell(3, 6).value, '70% transmutation');
  store.close();
});

test('the exported final grade is exactly two decimals and never rounded up', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-grades.xlsx');
  const result = computeCourse(store, course.id, tables);
  await exportGradeRecord(result, file);

  const wb = await readBack(file);
  const ws = wb.worksheets[0];
  const row = rowFor(ws, headerRowOf(ws), 'Allison, Elizabeth Y.');
  assert.ok(row, 'the student should appear in the export');

  const exported = String(row['Final Grade']);
  const computed = result.students.find((r) => r.student.full_name === 'Allison, Elizabeth Y.');
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
  const row = rowFor(wb.worksheets[0], headerRowOf(wb.worksheets[0]), 'Dogbeh, Princess');
  assert.equal(row['Letter Grade'], 'I');
  store.close();
});

test('a blank raw score exports as blank, not as zero', async () => {
  const { store, course } = seed();
  const file = path.join(tmpDir, 'record-blank.xlsx');
  await exportGradeRecord(computeCourse(store, course.id, tables), file);

  const wb = await readBack(file);
  const row = rowFor(wb.worksheets[0], headerRowOf(wb.worksheets[0]), 'Dogbeh, Princess');
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
  assert.deepEqual(headers, ['No.', 'ID', 'FullName', 'Final Grade', 'Letter Grade']);

  const row = rowFor(ws, headerRowOf(ws), 'Allison, Elizabeth Y.');
  assert.equal(row.ID, '44305');
  assert.equal(
    row['Final Grade'],
    result.students.find((r) => r.student.full_name === 'Allison, Elizabeth Y.').finalGradeDisplay
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
  assert.ok(rowFor(wb.worksheets[0], headerRowOf(wb.worksheets[0]), 'Allison, Elizabeth Y.'));
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

  // The blue term banner sits two rows above the headers, the weights one above.
  assert.equal(argb(hr - 2, 4), 'FF2F75B5', 'term banner should be blue');
  assert.match(String(ws.getCell(hr - 2, 4).value), /Mid-Term/);
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
  let row = null;
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    if (String(ws.getRow(r).getCell(3).value ?? '').trim() === 'Allison, Elizabeth Y.') { row = r; break; }
  }
  assert.ok(row, 'the flagged student should be in the sheet');
  const fill = ws.getCell(row, 3).fill;
  assert.equal(fill && fill.fgColor && fill.fgColor.argb, 'FFFFF2CC', 'their name cell is highlighted');
  assert.match(String(ws.getCell(row, 3).note || ''), /addendum expected/, 'the note is attached');
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
  const row = rowFor(ws, 5, 'Allison, Elizabeth Y.');
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
