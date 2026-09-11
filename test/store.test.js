'use strict';
/**
 * Data layer tests: the model from Appendix B, semester archiving, the
 * store-to-engine bridge, issue review, and backup round-tripping.
 *
 * Every test runs against an in-memory database, so the suite stays fast and
 * never touches the instructor's real data.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store, EXAM_MAX_POINTS } = require('../src/data/store');
const { computeCourse, reviewIssues } = require('../src/data/gradebook');
const { exportData, importData, exportToFile, importFromFile } = require('../src/data/backup');
const { TransmutationTables } = require('../src/engine');

const tables = new TransmutationTables(require('../data/transmutation_tables.json'));

function newStore() {
  return new Store(':memory:');
}

/** A course with a realistic assessment set, mirroring the real workbook. */
function seedCourse(store, { policy = '70' } = {}) {
  const semester = store.createSemester('2026–2027 Semester 1');
  const course = store.createCourse({
    semesterId: semester.id,
    code: 'CSE 102',
    name: 'Computer Literacy',
    section: '2',
    policy,
  });
  const { byKind } = store.getTerms(course.id);

  const mid = byKind.midterm;
  const fin = byKind.final;
  const a = {
    midAttendance: store.addAssessment(mid.id, { name: 'Attendance', maxPoints: 10, kind: 'attendance' }),
    midAssign: store.addAssessment(mid.id, { name: 'Assign 1', maxPoints: 10 }),
    midQuiz1: store.addAssessment(mid.id, { name: 'Quiz 1', maxPoints: 15 }),
    midQuiz2: store.addAssessment(mid.id, { name: 'Quiz 2', maxPoints: 15 }),
    midClassWork: store.addAssessment(mid.id, { name: 'ClassWork', maxPoints: 10 }),
    midExam: store.getExam(mid.id),
    finAttendance: store.addAssessment(fin.id, { name: 'Attendance', maxPoints: 10, kind: 'attendance' }),
    finAssign: store.addAssessment(fin.id, { name: 'Assign 2', maxPoints: 10 }),
    finQuiz3: store.addAssessment(fin.id, { name: 'Quiz 3', maxPoints: 15 }),
    finProject: store.addAssessment(fin.id, { name: 'Project', maxPoints: 25 }),
    finExam: store.getExam(fin.id),
  };
  return { semester, course, terms: byKind, a };
}

// ------------------------------------------------------------------ semesters

test('a new semester becomes active and archives the previous one', () => {
  const store = newStore();
  const first = store.createSemester('2025–2026 Semester 2');
  assert.equal(first.is_active, 1);
  assert.equal(first.archived_at, null);

  const second = store.createSemester('2026–2027 Semester 1');
  assert.equal(second.is_active, 1);
  assert.equal(store.getSemester(first.id).is_active, 0);
  assert.ok(store.getSemester(first.id).archived_at, 'the previous semester is archived');
  assert.equal(store.getActiveSemester().id, second.id);
  store.close();
});

test('exactly one semester is active, enforced by the database', () => {
  const store = newStore();
  store.createSemester('A');
  store.createSemester('B');
  store.createSemester('C');
  const active = store.db.prepare('SELECT COUNT(*) AS n FROM semesters WHERE is_active = 1').get().n;
  assert.equal(active, 1);
  // The constraint is real, not just convention.
  assert.throws(() => {
    store.db.prepare('UPDATE semesters SET is_active = 1 WHERE name = ?').run('A');
  }, /UNIQUE/);
  store.close();
});

test('an archived semester can be reopened and stays exportable', () => {
  const store = newStore();
  const first = store.createSemester('2025–2026 Semester 2');
  const second = store.createSemester('2026–2027 Semester 1');

  const reopened = store.activateSemester(first.id);
  assert.equal(reopened.is_active, 1);
  assert.equal(reopened.archived_at, null, 'reopening clears the archive stamp');
  assert.equal(store.getSemester(second.id).is_active, 0);
  store.close();
});

test('a semester can be created without activating it', () => {
  const store = newStore();
  const active = store.createSemester('Active');
  const parked = store.createSemester('Parked', { activate: false });
  assert.equal(parked.is_active, 0);
  assert.equal(store.getActiveSemester().id, active.id);
  store.close();
});

// -------------------------------------------------------------------- courses

test('a new course gets both terms and a fixed 40-point exam in each', () => {
  const store = newStore();
  const semester = store.createSemester('S1');
  const course = store.createCourse({ semesterId: semester.id, code: 'CSE 102' });

  const { list, byKind } = store.getTerms(course.id);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((t) => t.kind), ['midterm', 'final']);

  for (const kind of ['midterm', 'final']) {
    const exam = store.getExam(byKind[kind].id);
    assert.ok(exam, `${kind} should have an exam`);
    assert.equal(exam.max_points, EXAM_MAX_POINTS);
    assert.equal(exam.kind, 'exam');
  }
  store.close();
});

test('the exam maximum cannot be changed away from 40', () => {
  const store = newStore();
  const { terms } = seedCourse(store);
  const exam = store.getExam(terms.midterm.id);
  const updated = store.updateAssessment(exam.id, { maxPoints: 100 });
  assert.equal(updated.max_points, EXAM_MAX_POINTS, 'the exam stays at 40');
  store.close();
});

test('a term cannot hold two exams', () => {
  const store = newStore();
  const { terms } = seedCourse(store);
  assert.throws(
    () => store.addAssessment(terms.midterm.id, { name: 'Second Exam', kind: 'exam' }),
    /UNIQUE/
  );
  store.close();
});

test('courses default to the 70% policy', () => {
  const store = newStore();
  const semester = store.createSemester('S1');
  const course = store.createCourse({ semesterId: semester.id, code: 'X' });
  assert.equal(course.policy, '70');
  store.close();
});

test('deleting a course removes its scores rather than orphaning them', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ studentId: '1', fullName: 'A' }]);
  store.setScore(s.id, a.midQuiz1.id, 12);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 1);

  store.deleteCourse(course.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM assessments').get().n, 0);
  store.close();
});

// ------------------------------------------------------------------- students

test('roster rows keep their typed order and auto-number', () => {
  const store = newStore();
  const { course } = seedCourse(store);
  store.addStudents(course.id, [
    { studentId: '10001', fullName: 'Bestman, Comfort K.' },
    { studentId: '10002', fullName: 'Bestman, Daniel T.' },
    { studentId: '10003', fullName: 'Cooper, Grace A.' },
  ]);
  const roster = store.listStudents(course.id);
  assert.deepEqual(roster.map((s) => s.number), [1, 2, 3]);
  assert.equal(roster[2].full_name, 'Cooper, Grace A.');
  store.close();
});

// --------------------------------------------------------------------- scores

test('a score round-trips and a blank is stored as blank, not zero', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'A' }]);

  store.setScore(s.id, a.midQuiz1.id, 12);
  assert.equal(store.getScore(s.id, a.midQuiz1.id), 12);

  store.setScore(s.id, a.midQuiz1.id, 0);
  assert.equal(store.getScore(s.id, a.midQuiz1.id), 0, 'a real zero is kept');

  store.setScore(s.id, a.midQuiz1.id, null);
  assert.equal(store.getScore(s.id, a.midQuiz1.id), null, 'blank is distinct from zero');
  store.close();
});

test('scores survive closing and reopening the database file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-'));
  const file = path.join(dir, 'data.gradedesk');
  let studentId;
  let assessmentId;
  {
    const store = new Store(file);
    const { course, a } = seedCourse(store);
    const [s] = store.addStudents(course.id, [{ fullName: 'Persisted, Student' }]);
    store.setScore(s.id, a.midQuiz1.id, 14);
    studentId = s.id;
    assessmentId = a.midQuiz1.id;
    store.close();
  }
  {
    const store = new Store(file);
    assert.equal(store.getScore(studentId, assessmentId), 14);
    assert.equal(store.getStudent(studentId).full_name, 'Persisted, Student');
    store.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the store reports how many scores an assessment holds before deletion', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const roster = store.addStudents(course.id, [{ fullName: 'A' }, { fullName: 'B' }, { fullName: 'C' }]);
  store.setScore(roster[0].id, a.midQuiz1.id, 10);
  store.setScore(roster[1].id, a.midQuiz1.id, 12);
  store.setScore(roster[2].id, a.midQuiz1.id, null); // blank does not count

  assert.equal(store.countScores(a.midQuiz1.id), 2);
  store.close();
});

// ----------------------------------------------------------------- attendance

test('attendance marks resolve into a raw score through the engine', () => {
  const store = newStore();
  const { course, terms, a } = seedCourse(store);
  const roster = store.addStudents(course.id, [{ fullName: 'Present, Al' }, { fullName: 'Mixed, Mo' }]);

  const s1 = store.addSession(course.id, terms.midterm.id, '2026-09-02');
  const s2 = store.addSession(course.id, terms.midterm.id, '2026-09-04');
  const s3 = store.addSession(course.id, terms.midterm.id, '2026-09-09');

  for (const s of [s1, s2, s3]) store.setMark(roster[0].id, s.id, 'P');
  store.setMark(roster[1].id, s1.id, 'P');
  store.setMark(roster[1].id, s2.id, 'E');
  // Third session left unmarked for this student: excluded from the denominator.

  const result = computeCourse(store, course.id, tables);
  const attendanceOf = (row) =>
    row.midterm.assessments.find((x) => x.assessment.id === a.midAttendance.id);

  assert.equal(attendanceOf(result.students[0]).raw, 10, 'all present over 3 sessions');
  // 1 P + 1 E over 2 marked sessions is 7.5, recorded as a whole 8.
  assert.equal(attendanceOf(result.students[1]).raw, 8, '1 P + 1 E over 2 marked sessions');
  store.close();
});

test('attendance with no sessions marked is blank and transmutes to 50', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  store.addStudents(course.id, [{ fullName: 'Nobody, Marked' }]);

  const result = computeCourse(store, course.id, tables);
  const att = result.students[0].midterm.assessments.find(
    (x) => x.assessment.id === a.midAttendance.id
  );
  assert.equal(att.raw, null);
  assert.equal(att.transmuted, 50);
  store.close();
});

// ------------------------------------------------------- store meets engine

test('a stored course reproduces the known worked example end to end', () => {
  // Bestman, Comfort K. from the real workbook: expects 90.39 and an A.
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ studentId: '10001', fullName: 'Bestman, Comfort K.' }]);

  // Attendance is auto-computed, so mark a session to yield a raw 10.
  const { byKind } = store.getTerms(course.id);
  const midSession = store.addSession(course.id, byKind.midterm.id, '2026-09-02');
  store.setMark(s.id, midSession.id, 'P');
  const finSession = store.addSession(course.id, byKind.final.id, '2026-11-02');
  store.setMark(s.id, finSession.id, 'P');

  store.setScore(s.id, a.midAssign.id, 10);
  store.setScore(s.id, a.midQuiz1.id, 11);
  store.setScore(s.id, a.midQuiz2.id, 15);
  store.setScore(s.id, a.midClassWork.id, 8);
  store.setScore(s.id, a.midExam.id, 31);
  store.setScore(s.id, a.finAssign.id, 10);
  store.setScore(s.id, a.finQuiz3.id, 15);
  store.setScore(s.id, a.finProject.id, 23);
  store.setScore(s.id, a.finExam.id, 35);

  const result = computeCourse(store, course.id, tables);
  const row = result.students[0];
  assert.equal(row.midterm.classStanding, 54);
  assert.equal(row.midterm.total, 85.2);
  assert.equal(row.final.total, 93.85);
  assert.equal(row.finalGradeDisplay, '90.39');
  assert.equal(row.letter, 'A');
  store.close();
});

test('removing an assessment changes the average with no reweighting', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'A' }]);
  store.setScore(s.id, a.midQuiz1.id, 15);
  store.setScore(s.id, a.midQuiz2.id, 0);

  const before = computeCourse(store, course.id, tables).students[0].midterm.classStanding;
  store.deleteAssessment(a.midQuiz2.id);
  const after = computeCourse(store, course.id, tables).students[0].midterm.classStanding;

  assert.notEqual(before, after);
  // Four assessments remain: attendance (blank -> 50), Assign 1 (blank -> 50),
  // Quiz 1 (15/15 -> 100), ClassWork (blank -> 50). Average 62.5, times 0.6.
  assert.equal(after, 62.5 * 0.6);
  store.close();
});

// ------------------------------------------------------------- issue review

test('issue review flags a score above its maximum', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'Typo, Tim' }]);
  store.setScore(s.id, a.midQuiz1.id, 51); // out of 15

  const issues = reviewIssues(store, course.id, tables);
  const found = issues.find((i) => i.kind === 'score_above_max');
  assert.ok(found, 'should flag the over-maximum score');
  assert.equal(found.severity, 'error');
  assert.match(found.message, /above the maximum of 15/);
  store.close();
});

test('issue review lists blank exams that force an I', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'Absent, Ann' }]);
  store.setScore(s.id, a.midExam.id, 30);
  // Final exam left blank.

  const issues = reviewIssues(store, course.id, tables);
  const found = issues.find((i) => i.kind === 'blank_exam');
  assert.ok(found);
  assert.match(found.message, /final exam/);
  assert.match(found.message, /letter grade is I/);
  store.close();
});

test('issue review reports blank scores that silently count as 50', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'Partial, Pat' }]);
  store.setScore(s.id, a.midExam.id, 30);
  store.setScore(s.id, a.finExam.id, 30);

  const issues = reviewIssues(store, course.id, tables);
  const found = issues.find((i) => i.kind === 'blank_scores');
  assert.ok(found);
  assert.match(found.message, /counting as 50/);
  store.close();
});

test('issues are ordered with errors first', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'Many, Issues' }]);
  store.setScore(s.id, a.midQuiz1.id, 99); // error

  const issues = reviewIssues(store, course.id, tables);
  assert.ok(issues.length >= 2);
  assert.equal(issues[0].severity, 'error');
  const severities = issues.map((i) => i.severity);
  const rank = { error: 0, warning: 1, info: 2 };
  for (let i = 1; i < severities.length; i++) {
    assert.ok(rank[severities[i]] >= rank[severities[i - 1]], 'severity order');
  }
  store.close();
});

// -------------------------------------------------------------------- backup

test('a backup round-trips every table exactly', () => {
  const store = newStore();
  const { course, terms, a } = seedCourse(store);
  const roster = store.addStudents(course.id, [
    { studentId: '1', fullName: 'A, One' },
    { studentId: '2', fullName: 'B, Two' },
  ]);
  const session = store.addSession(course.id, terms.midterm.id, '2026-09-02');
  store.setMark(roster[0].id, session.id, 'P');
  store.setMark(roster[1].id, session.id, 'E');
  store.setScore(roster[0].id, a.midQuiz1.id, 12);
  store.setScore(roster[1].id, a.midQuiz1.id, null);

  const before = computeCourse(store, course.id, tables);
  const payload = exportData(store);

  // Wipe by restoring into a fresh store.
  const restored = newStore();
  importData(restored, payload);

  const after = computeCourse(restored, course.id, tables);
  assert.deepEqual(
    after.students.map((r) => [r.student.full_name, r.finalGradeDisplay, r.letter]),
    before.students.map((r) => [r.student.full_name, r.finalGradeDisplay, r.letter])
  );
  assert.equal(restored.getScore(roster[0].id, a.midQuiz1.id), 12);
  assert.equal(restored.getScore(roster[1].id, a.midQuiz1.id), null);
  assert.equal(restored.getMark(roster[1].id, session.id), 'E');
  store.close();
  restored.close();
});

test('a backup writes to and reads from a real file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-backup-'));
  const file = path.join(dir, 'backup.gradedesk.json');

  const store = newStore();
  const { course } = seedCourse(store);
  store.addStudents(course.id, [{ studentId: '9', fullName: 'Round, Trip' }]);
  const payload = exportToFile(store, file);
  assert.ok(fs.existsSync(file));
  assert.equal(payload.counts.students, 1);

  const restored = newStore();
  const result = importFromFile(restored, file);
  assert.ok(result.restored > 0);
  assert.equal(restored.listStudents(course.id)[0].full_name, 'Round, Trip');

  store.close();
  restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('importing replaces existing data rather than merging it', () => {
  const storeA = newStore();
  const { course: courseA } = seedCourse(storeA);
  storeA.addStudents(courseA.id, [{ fullName: 'Original, Only' }]);
  const payload = exportData(storeA);

  const storeB = newStore();
  const { course: courseB } = seedCourse(storeB);
  storeB.addStudents(courseB.id, [{ fullName: 'Should, Vanish' }]);

  importData(storeB, payload);
  const names = storeB.db.prepare('SELECT full_name FROM students').all().map((r) => r.full_name);
  assert.deepEqual(names, ['Original, Only']);
  storeA.close();
  storeB.close();
});

test('a foreign file is refused with a clear message', () => {
  const store = newStore();
  assert.throws(() => importData(store, { format: 'something-else', data: {} }), /not a GradeDesk backup/);
  assert.throws(() => importData(store, null), /not a GradeDesk backup/);
  store.close();
});

test('a backup from a newer version is refused rather than half-read', () => {
  const store = newStore();
  assert.throws(
    () => importData(store, { format: 'gradedesk-backup', version: 999, data: {} }),
    /newer version of GradeDesk/
  );
  store.close();
});

test('a malformed backup leaves existing data untouched', () => {
  const store = newStore();
  const { course } = seedCourse(store);
  store.addStudents(course.id, [{ fullName: 'Still, Here' }]);

  assert.throws(
    () => importData(store, { format: 'gradedesk-backup', version: 1, data: { students: 'not-a-list' } }),
    /malformed/
  );
  assert.equal(store.listStudents(course.id)[0].full_name, 'Still, Here');
  store.close();
});

// --------------------------------------------------------- issue freshness

test('issue review reflects the latest scores, not a stale snapshot', () => {
  // The UI once captured the issue list when the screen rendered and reused it
  // when the button was clicked, so a score typed in between was never checked.
  // Found by driving the real app: a 99 entered into a 15-point quiz did not
  // appear in the review. The store-level guarantee is that a fresh call always
  // reflects the current data.
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'Typo, Tim' }]);

  const before = reviewIssues(store, course.id, tables);
  assert.equal(before.filter((i) => i.kind === 'score_above_max').length, 0);

  store.setScore(s.id, a.midQuiz1.id, 99); // out of 15
  const after = reviewIssues(store, course.id, tables);
  assert.equal(after.filter((i) => i.kind === 'score_above_max').length, 1);

  // And correcting it clears the issue again.
  store.setScore(s.id, a.midQuiz1.id, 12);
  const fixed = reviewIssues(store, course.id, tables);
  assert.equal(fixed.filter((i) => i.kind === 'score_above_max').length, 0);
  store.close();
});

test('an over-maximum exam score is flagged too', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'Over, Exam' }]);
  store.setScore(s.id, a.midExam.id, 45); // the exam is fixed at 40

  const issues = reviewIssues(store, course.id, tables);
  const found = issues.find((i) => i.kind === 'score_above_max');
  assert.ok(found, 'an exam above 40 should be flagged');
  assert.match(found.message, /above the maximum of 40/);
  store.close();
});

test('empty roster rows are summarised, not reported one student at a time', () => {
  // "Add 5 rows" creates blanks the instructor has not filled in yet. Treating
  // each as a student with nine missing scores buried the real issues.
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [real] = store.addStudents(course.id, [{ studentId: '10001', fullName: 'Sample, Student' }]);
  store.addStudents(course.id, [{}, {}, {}]); // three blank rows
  store.setScore(real.id, a.midExam.id, 30);
  store.setScore(real.id, a.finExam.id, 30);

  const issues = reviewIssues(store, course.id, tables);
  const perStudent = issues.filter((i) => i.student);
  const summary = issues.filter((i) => i.kind === 'blank_roster_row');

  assert.equal(summary.length, 1, 'one summary line for all blank rows');
  assert.match(summary[0].message, /3 empty roster rows/);
  assert.ok(
    perStudent.every((i) => i.student.id === real.id),
    'no per-student issue should name a blank row'
  );
  store.close();
});

test('a row with an ID but no name is still a real student', () => {
  // Half-entered is not the same as untouched: it should still be checked.
  const store = newStore();
  const { course } = seedCourse(store);
  store.addStudents(course.id, [{ studentId: '10001', fullName: '' }]);

  const issues = reviewIssues(store, course.id, tables);
  assert.equal(issues.filter((i) => i.kind === 'blank_roster_row').length, 0);
  assert.ok(issues.some((i) => i.kind === 'blank_exam'), 'it is checked like any student');
  store.close();
});

// -------------------------------------------------- attendance sessions

test('the same session date cannot be added twice to a course', () => {
  // A duplicate would silently double that day's weight in every attendance
  // score, since the denominator counts sessions.
  const store = newStore();
  const { course, terms } = seedCourse(store);
  store.addSession(course.id, terms.midterm.id, '2026-09-02');

  assert.throws(
    () => store.addSession(course.id, terms.midterm.id, '2026-09-02'),
    /already a session on 2026-09-02/
  );
  assert.equal(store.listSessions(terms.midterm.id).length, 1);
  store.close();
});

test('a duplicate is refused across terms, not just within one', () => {
  const store = newStore();
  const { course, terms } = seedCourse(store);
  store.addSession(course.id, terms.midterm.id, '2026-09-02');
  assert.throws(
    () => store.addSession(course.id, terms.final.id, '2026-09-02'),
    /already a session on 2026-09-02/
  );
  store.close();
});

test('the same date in a different course is fine', () => {
  const store = newStore();
  const { course, terms } = seedCourse(store);
  const other = store.createCourse({ semesterId: store.getActiveSemester().id, code: 'CSE 205' });
  const otherTerms = store.getTerms(other.id).byKind;

  store.addSession(course.id, terms.midterm.id, '2026-09-02');
  const second = store.addSession(other.id, otherTerms.midterm.id, '2026-09-02');
  assert.ok(second, 'two different courses can meet on the same day');
  store.close();
});

test('a past date can be added, and sessions stay in date order', () => {
  // Attendance is often entered days later from a paper register, so a
  // back-dated session must slot into the right column, not the end.
  const store = newStore();
  const { course, terms } = seedCourse(store);
  store.addSession(course.id, terms.midterm.id, '2026-09-11');
  store.addSession(course.id, terms.midterm.id, '2026-09-02');
  store.addSession(course.id, terms.midterm.id, '2026-09-09');

  assert.deepEqual(
    store.listSessions(terms.midterm.id).map((s) => s.date),
    ['2026-09-02', '2026-09-09', '2026-09-11']
  );
  store.close();
});

test('a session needs a date', () => {
  const store = newStore();
  const { course, terms } = seedCourse(store);
  assert.throws(() => store.addSession(course.id, terms.midterm.id, '   '), /needs a date/);
  store.close();
});

// ------------------------------------------- students not on the roster

test('a student can be flagged as not on the official roster, and cleared', () => {
  const store = newStore();
  const { course } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ studentId: '10001', fullName: 'Guest, One' }]);
  assert.equal(store.getStudent(s.id).unofficial, 0, 'students start on the roster');

  store.updateStudent(s.id, { unofficial: 1, note: 'Sent by the dean' });
  assert.equal(store.getStudent(s.id).unofficial, 1);
  assert.equal(store.getStudent(s.id).note, 'Sent by the dean');

  store.updateStudent(s.id, { unofficial: 0 });
  assert.equal(store.getStudent(s.id).unofficial, 0, 'the flag clears once they are added');
  store.close();
});

test('the flag changes nothing about a student grade', () => {
  // It is a reminder for the instructor, not part of the marking.
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ fullName: 'Guest, One' }]);
  store.setScore(s.id, a.midQuiz1.id, 12);
  store.setScore(s.id, a.midExam.id, 30);
  store.setScore(s.id, a.finQuiz3.id, 12);
  store.setScore(s.id, a.finExam.id, 30);

  const before = computeCourse(store, course.id, tables).students[0];
  store.updateStudent(s.id, { unofficial: 1, note: 'pending' });
  const after = computeCourse(store, course.id, tables).students[0];

  assert.equal(after.finalGradeDisplay, before.finalGradeDisplay);
  assert.equal(after.letter, before.letter);
  assert.equal(after.student.unofficial, 1, 'but the flag travels with the student');
  store.close();
});

test('issue review reminds the instructor about every flagged student', () => {
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [one, two] = store.addStudents(course.id, [
    { studentId: '1', fullName: 'Guest, One' },
    { studentId: '2', fullName: 'Regular, Two' },
  ]);
  for (const s of [one, two]) {
    store.setScore(s.id, a.midExam.id, 30);
    store.setScore(s.id, a.finExam.id, 30);
  }
  store.updateStudent(one.id, { unofficial: 1, note: 'addendum expected' });

  const issues = reviewIssues(store, course.id, tables);
  const flagged = issues.filter((i) => i.kind === 'not_on_roster');
  assert.equal(flagged.length, 1, 'one reminder, for the one flagged student');
  assert.match(flagged[0].message, /Guest, One/);
  assert.match(flagged[0].message, /addendum expected/);
  assert.equal(flagged[0].severity, 'warning');

  store.updateStudent(one.id, { unofficial: 0 });
  assert.equal(
    reviewIssues(store, course.id, tables).filter((i) => i.kind === 'not_on_roster').length,
    0,
    'the reminder stops once the flag is cleared'
  );
  store.close();
});

test('the flag survives a backup and restore', () => {
  const store = newStore();
  const { course } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ studentId: '9', fullName: 'Guest, One' }]);
  store.updateStudent(s.id, { unofficial: 1, note: 'waiting on paperwork' });

  const restored = newStore();
  importData(restored, exportData(store));
  const back = restored.listStudents(course.id)[0];
  assert.equal(back.unofficial, 1);
  assert.equal(back.note, 'waiting on paperwork');
  store.close();
  restored.close();
});

// ------------------------------------------- reordering, copying, duplicating

test('reordering rewrites sort_order and survives a reload', () => {
  const store = newStore();
  const { terms, a } = seedCourse(store);
  const before = store.listClassStandingAssessments(terms.midterm.id).map((x) => x.name);
  assert.deepEqual(before, ['Attendance', 'Assign 1', 'Quiz 1', 'Quiz 2', 'ClassWork']);

  // Put ClassWork first and Attendance last.
  store.reorderAssessments(terms.midterm.id, [
    a.midClassWork.id, a.midAssign.id, a.midQuiz1.id, a.midQuiz2.id, a.midAttendance.id,
  ]);
  const after = store.listClassStandingAssessments(terms.midterm.id).map((x) => x.name);
  assert.deepEqual(after, ['ClassWork', 'Assign 1', 'Quiz 1', 'Quiz 2', 'Attendance']);
  store.close();
});

test('reordering never moves the exam out of last place', () => {
  const store = newStore();
  const { terms, a } = seedCourse(store);
  // Try to drag the exam to the front. It must be ignored.
  store.reorderAssessments(terms.midterm.id, [a.midExam.id, a.midQuiz1.id]);
  const all = store.listAssessments(terms.midterm.id);
  assert.equal(all[all.length - 1].kind, 'exam', 'the exam stays last');
  store.close();
});

test('reordering ignores ids from another term', () => {
  const store = newStore();
  const { terms, a } = seedCourse(store);
  const before = store.listClassStandingAssessments(terms.midterm.id).map((x) => x.id);
  // finQuiz3 belongs to the final term and must not be pulled in.
  store.reorderAssessments(terms.midterm.id, [a.finQuiz3.id, ...before]);
  const after = store.listClassStandingAssessments(terms.midterm.id).map((x) => x.id);
  assert.deepEqual(after, before, 'the foreign id changed nothing');
  assert.equal(store.getAssessment(a.finQuiz3.id).term_id, terms.final.id, 'and it stayed put');
  store.close();
});

test('copying a term brings names and points but never scores', () => {
  const store = newStore();
  const { course, terms, a } = seedCourse(store);
  const [student] = store.addStudents(course.id, [{ studentId: '1', fullName: 'Test, One' }]);
  store.setScore(student.id, a.midQuiz1.id, 12);

  // Copy midterm into a brand new course's empty midterm.
  const target = store.createCourse({ semesterId: course.semester_id, code: 'NEW 101' });
  const targetTerms = store.getTerms(target.id).byKind;
  const { copied } = store.copyAssessmentsToTerm(terms.midterm.id, targetTerms.midterm.id);

  assert.equal(copied, 5, 'all five class-standing rows copied');
  const names = store.listClassStandingAssessments(targetTerms.midterm.id).map((x) => x.name);
  assert.deepEqual(names, ['Attendance', 'Assign 1', 'Quiz 1', 'Quiz 2', 'ClassWork']);

  const copiedQuiz = store.listClassStandingAssessments(targetTerms.midterm.id).find((x) => x.name === 'Quiz 1');
  assert.equal(copiedQuiz.max_points, 15, 'point value came across');
  assert.equal(store.getScore(student.id, copiedQuiz.id), null, 'no score came across');
  store.close();
});

test('copying twice does not double the assessments', () => {
  const store = newStore();
  const { course, terms } = seedCourse(store);
  const target = store.createCourse({ semesterId: course.semester_id, code: 'NEW 101' });
  const targetTerms = store.getTerms(target.id).byKind;

  store.copyAssessmentsToTerm(terms.midterm.id, targetTerms.midterm.id);
  const second = store.copyAssessmentsToTerm(terms.midterm.id, targetTerms.midterm.id);

  assert.equal(second.copied, 0, 'nothing copied the second time');
  assert.equal(store.listClassStandingAssessments(targetTerms.midterm.id).length, 5);
  store.close();
});

test('copying never gives a term a second attendance or a second exam', () => {
  const store = newStore();
  const { terms } = seedCourse(store);
  // The final term already has its own Attendance and its own exam.
  store.copyAssessmentsToTerm(terms.midterm.id, terms.final.id);

  const all = store.listAssessments(terms.final.id);
  assert.equal(all.filter((x) => x.kind === 'attendance').length, 1, 'still one attendance');
  assert.equal(all.filter((x) => x.kind === 'exam').length, 1, 'still one exam');
  store.close();
});

test('duplicating a course carries the assessments and nothing else', () => {
  const store = newStore();
  const { course, terms, a } = seedCourse(store);

  // Give the source a roster, a score, and a marked attendance session.
  const [student] = store.addStudents(course.id, [{ studentId: '1', fullName: 'Test, One' }]);
  store.setScore(student.id, a.midQuiz1.id, 12);
  const session = store.addSession(course.id, terms.midterm.id, '2026-09-01');
  store.setMark(student.id, session.id, 'P');

  const copy = store.duplicateCourse(course.id, { code: 'CSE 102', section: '3' });

  assert.notEqual(copy.id, course.id);
  assert.equal(copy.section, '3', 'the override applied');
  assert.equal(copy.policy, course.policy, 'policy carried over');
  assert.equal(copy.name, course.name, 'name carried over');

  const copyTerms = store.getTerms(copy.id).byKind;
  assert.deepEqual(
    store.listClassStandingAssessments(copyTerms.midterm.id).map((x) => x.name),
    ['Attendance', 'Assign 1', 'Quiz 1', 'Quiz 2', 'ClassWork'],
    'midterm structure carried over'
  );
  assert.deepEqual(
    store.listClassStandingAssessments(copyTerms.final.id).map((x) => x.name),
    ['Attendance', 'Assign 2', 'Quiz 3', 'Project'],
    'final structure carried over'
  );
  assert.equal(store.getExam(copyTerms.midterm.id).max_points, EXAM_MAX_POINTS, 'exam present and fixed');

  // The point of the feature: the people and their marks do NOT come along.
  assert.equal(store.listStudents(copy.id).length, 0, 'no students copied');
  assert.equal(store.listSessions(copyTerms.midterm.id).length, 0, 'no attendance sessions copied');

  // And the source is untouched.
  assert.equal(store.listStudents(course.id).length, 1, 'source roster intact');
  assert.equal(store.getScore(student.id, a.midQuiz1.id), 12, 'source score intact');
  store.close();
});

test('duplicating a missing course fails instead of making an empty one', () => {
  const store = newStore();
  assert.throws(() => store.duplicateCourse(9999), /not found/i);
  store.close();
});

// ------------------------------------------------------------ saved presets

test('a term can be saved as a preset, without its exam', () => {
  const store = newStore();
  const { terms } = seedCourse(store);
  const items = store.listAssessments(terms.midterm.id);

  const preset = store.savePreset('My usual set', items);
  assert.equal(preset.name, 'My usual set');
  assert.deepEqual(
    preset.items.map((i) => i.name),
    ['Attendance', 'Assign 1', 'Quiz 1', 'Quiz 2', 'ClassWork'],
    'order is kept and the exam is left out'
  );
  assert.equal(preset.items.filter((i) => i.kind === 'exam').length, 0);
  assert.equal(preset.items.find((i) => i.name === 'Attendance').kind, 'attendance');
  assert.equal(preset.items.find((i) => i.name === 'Quiz 1').max_points, 15);
  store.close();
});

test('saving over an existing name replaces it rather than duplicating', () => {
  const store = newStore();
  const { terms } = seedCourse(store);
  store.savePreset('Set A', store.listAssessments(terms.midterm.id));
  store.savePreset('Set A', [{ name: 'Only this', maxPoints: 10 }]);

  const all = store.listPresets();
  assert.equal(all.length, 1, 'still one preset');
  assert.deepEqual(all[0].items.map((i) => i.name), ['Only this']);
  store.close();
});

test('a preset with no usable rows is refused', () => {
  const store = newStore();
  assert.throws(() => store.savePreset('Empty', []), /no assessments/i);
  // An exam on its own is not a preset either.
  assert.throws(
    () => store.savePreset('Exam only', [{ name: 'Final Exam', maxPoints: 40, kind: 'exam' }]),
    /no assessments/i
  );
  assert.throws(() => store.savePreset('   ', [{ name: 'Quiz', maxPoints: 10 }]), /needs a name/i);
  store.close();
});

test('renaming a preset refuses a name that is taken', () => {
  const store = newStore();
  store.savePreset('First', [{ name: 'Quiz', maxPoints: 10 }]);
  const second = store.savePreset('Second', [{ name: 'Quiz', maxPoints: 10 }]);

  assert.throws(() => store.renamePreset(second.id, 'First'), /already a preset/i);
  // Renaming to its own name is fine, not a false clash.
  const same = store.renamePreset(second.id, 'Second');
  assert.equal(same.name, 'Second');
  store.close();
});

test('deleting a preset takes its rows with it', () => {
  const store = newStore();
  const preset = store.savePreset('Doomed', [
    { name: 'Quiz 1', maxPoints: 15 },
    { name: 'Quiz 2', maxPoints: 15 },
  ]);
  const before = store.db.prepare('SELECT COUNT(*) AS n FROM preset_items').get().n;
  assert.equal(before, 2);

  store.deletePreset(preset.id);
  assert.equal(store.getPreset(preset.id), null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM preset_items').get().n, 0, 'cascade');
  store.close();
});

test('deleting a course leaves saved presets alone', () => {
  const store = newStore();
  const { course, terms } = seedCourse(store);
  store.savePreset('Kept', store.listAssessments(terms.midterm.id));

  store.deleteCourse(course.id);
  const all = store.listPresets();
  assert.equal(all.length, 1, 'the preset outlives the course it came from');
  assert.equal(all[0].items.length, 5);
  store.close();
});

test('saved presets survive a backup and restore', () => {
  const store = newStore();
  const { terms } = seedCourse(store);
  store.savePreset('Carried over', store.listAssessments(terms.midterm.id));

  const restored = newStore();
  importData(restored, exportData(store));

  const all = restored.listPresets();
  assert.equal(all.length, 1, 'a new table must be in backup.js TABLES or it vanishes silently');
  assert.equal(all[0].name, 'Carried over');
  assert.deepEqual(
    all[0].items.map((i) => i.name),
    ['Attendance', 'Assign 1', 'Quiz 1', 'Quiz 2', 'ClassWork']
  );
  store.close();
  restored.close();
});

test('copying a term carries assessments that share a name', () => {
  // Two quizzes both called "Quiz" is a normal way to set a term up. An
  // earlier version added each copied name to the skip set as it went, so the
  // second one was treated as a duplicate of the first and silently dropped.
  const store = newStore();
  const semester = store.createSemester('2026-2027 Semester 1');
  const course = store.createCourse({ semesterId: semester.id, code: 'SRC 101' });
  const { byKind } = store.getTerms(course.id);

  store.addAssessment(byKind.midterm.id, { name: 'Quiz', maxPoints: 15 });
  store.addAssessment(byKind.midterm.id, { name: 'Quiz', maxPoints: 15 });
  store.addAssessment(byKind.midterm.id, { name: 'Assign 1', maxPoints: 10 });

  const target = store.createCourse({ semesterId: semester.id, code: 'DST 101' });
  const targetTerms = store.getTerms(target.id).byKind;
  const { copied } = store.copyAssessmentsToTerm(byKind.midterm.id, targetTerms.midterm.id);

  assert.equal(copied, 3, 'both quizzes and the assignment come across');
  assert.deepEqual(
    store.listClassStandingAssessments(targetTerms.midterm.id).map((a) => a.name),
    ['Quiz', 'Quiz', 'Assign 1']
  );
  store.close();
});

test('a preset keeps rows that share a name', () => {
  const store = newStore();
  const preset = store.savePreset('Two quizzes', [
    { name: 'Quiz', maxPoints: 15 },
    { name: 'Quiz', maxPoints: 15 },
    { name: 'Assign 1', maxPoints: 10 },
  ]);
  assert.deepEqual(preset.items.map((i) => i.name), ['Quiz', 'Quiz', 'Assign 1']);
  store.close();
});
