'use strict';
/**
 * The end-to-end guarantee: real workbook in, GradeDesk out, same grades.
 *
 * Loads every student from the instructor's actual semester file, types their
 * raw scores into a real GradeDesk database through the ordinary store API,
 * computes with the gradebook the UI uses, exports to .xlsx, reopens that file,
 * and asserts the exported final grades and letters match the original workbook
 * for all 167 students.
 *
 * The engine test proves the math. This proves the whole pipeline: storage,
 * attendance resolution, the store-to-engine bridge, and the export layer.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const { Store } = require('../src/data/store');
const { computeCourse } = require('../src/data/gradebook');
const { exportGradeRecord } = require('../src/export/excel');
const { TransmutationTables } = require('../src/engine');
const { loadWorkbook } = require('./workbook-fixture');
const { exportData, importData } = require('../src/data/backup');

const tables = new TransmutationTables(require('../data/transmutation_tables.json'));
const POLICY = '70';
const EXPECTED_STUDENTS = 167;

let sections;
let tmpDir;

test.before(async () => {
  sections = await loadWorkbook();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-roundtrip-'));
});
test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Load one workbook section into a real GradeDesk store. */
function loadSectionIntoStore(store, semesterId, section) {
  const course = store.createCourse({
    semesterId,
    code: section.courseCode || section.name,
    name: section.courseName || '',
    section: '',
    policy: POLICY,
  });
  const { byKind } = store.getTerms(course.id);

  const midAssessments = section.midtermAssessments.map((a) =>
    store.addAssessment(byKind.midterm.id, { name: a.name, maxPoints: a.maxPoints })
  );
  const finAssessments = section.finalAssessments.map((a) =>
    store.addAssessment(byKind.final.id, { name: a.name, maxPoints: a.maxPoints })
  );
  const midExam = store.getExam(byKind.midterm.id);
  const finExam = store.getExam(byKind.final.id);

  const students = store.addStudents(
    course.id,
    section.students.map((s) => ({
      number: s.number,
      studentId: String(s.studentId ?? ''),
      fullName: s.fullName,
    }))
  );

  store.transaction(() => {
    section.students.forEach((src, i) => {
      const student = students[i];
      src.midtermRaw.forEach((raw, j) => store.setScore(student.id, midAssessments[j].id, raw));
      src.finalRaw.forEach((raw, j) => store.setScore(student.id, finAssessments[j].id, raw));
      store.setScore(student.id, midExam.id, src.midtermExamRaw);
      store.setScore(student.id, finExam.id, src.finalExamRaw);
    });
  });

  return { course, students };
}

test('the real workbook loads into GradeDesk and computes identically', () => {
  const store = new Store(':memory:');
  const semester = store.createSemester('2026–2027 Semester 1');
  let checked = 0;
  const mismatches = [];

  for (const section of sections) {
    const { course } = loadSectionIntoStore(store, semester.id, section);
    const result = computeCourse(store, course.id, tables);

    assert.equal(result.students.length, section.students.length, `${section.name} roster size`);
    result.students.forEach((row, i) => {
      const src = section.students[i];
      checked += 1;
      const expected = Number(src.storedFinalGrade);
      if (Math.abs(row.finalGrade - expected) > 1e-9) {
        mismatches.push(`${section.name} ${src.fullName}: got ${row.finalGrade} want ${expected}`);
      }
      if (src.storedLetter && row.letter !== src.storedLetter) {
        mismatches.push(`${section.name} ${src.fullName}: letter ${row.letter} want ${src.storedLetter}`);
      }
    });
  }

  assert.equal(checked, EXPECTED_STUDENTS, 'students checked');
  assert.deepEqual(mismatches, [], `${mismatches.length} mismatch(es) through the data layer`);
  store.close();
});

test('the exported workbook carries the same grades as the original', async () => {
  const store = new Store(':memory:');
  const semester = store.createSemester('2026–2027 Semester 1');
  const mismatches = [];
  let checked = 0;

  for (const section of sections) {
    const { course } = loadSectionIntoStore(store, semester.id, section);
    const result = computeCourse(store, course.id, tables);
    const file = path.join(tmpDir, `${section.name.replace(/[^\w]+/g, '_')}.xlsx`);
    await exportGradeRecord(result, file);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];

    // Map header -> column from the export's header row.
    const headerRow = 5;
    const cols = {};
    ws.getRow(headerRow).eachCell((cell, col) => {
      cols[String(cell.value ?? '')] = col;
    });
    assert.ok(cols['Final Grade'], `${section.name}: export is missing a Final Grade column`);

    section.students.forEach((src, i) => {
      const row = ws.getRow(headerRow + 1 + i);
      const name = String(row.getCell(cols.FullName).value ?? '');
      const grade = String(row.getCell(cols['Final Grade']).value ?? '');
      const letter = String(row.getCell(cols['Letter Grade']).value ?? '');
      checked += 1;

      if (name !== src.fullName) {
        mismatches.push(`${section.name} row ${i + 1}: name "${name}" want "${src.fullName}"`);
        return;
      }
      // The export shows two decimals truncated; compare against the same rule.
      const expected = result.students[i].finalGradeDisplay;
      if (grade !== expected) {
        mismatches.push(`${section.name} ${name}: exported ${grade} want ${expected}`);
      }
      if (src.storedLetter && letter !== src.storedLetter) {
        mismatches.push(`${section.name} ${name}: exported letter ${letter} want ${src.storedLetter}`);
      }
      // And the exported number must round-trip to the original workbook value.
      const original = Number(src.storedFinalGrade);
      if (Math.abs(Number(grade) - original) > 0.01) {
        mismatches.push(`${section.name} ${name}: exported ${grade} differs from workbook ${original}`);
      }
    });
  }

  assert.equal(checked, EXPECTED_STUDENTS, 'students checked in exports');
  assert.deepEqual(mismatches, [], `${mismatches.length} export mismatch(es)`);
  store.close();
});

test('a backup of the real semester restores to identical grades', () => {
  const store = new Store(':memory:');
  const semester = store.createSemester('2026–2027 Semester 1');
  const courseIds = sections.map((s) => loadSectionIntoStore(store, semester.id, s).course.id);
  const before = courseIds.map((id) =>
    computeCourse(store, id, tables).students.map((r) => `${r.student.full_name}|${r.finalGradeDisplay}|${r.letter}`)
  );

  const payload = exportData(store);
  const restored = new Store(':memory:');
  importData(restored, payload);

  const after = courseIds.map((id) =>
    computeCourse(restored, id, tables).students.map((r) => `${r.student.full_name}|${r.finalGradeDisplay}|${r.letter}`)
  );

  assert.deepEqual(after, before, 'a restored backup must grade identically');
  assert.equal(after.flat().length, EXPECTED_STUDENTS);
  store.close();
  restored.close();
});
