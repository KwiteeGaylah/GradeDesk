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
    { studentId: '44305', fullName: 'Allison, Elizabeth Y.' },
    { studentId: '38901', fullName: 'Allison, Emmanuel M.' },
    { studentId: '32474', fullName: 'Bioh, Alice T.' },
  ]);
  const roster = store.listStudents(course.id);
  assert.deepEqual(roster.map((s) => s.number), [1, 2, 3]);
  assert.equal(roster[2].full_name, 'Bioh, Alice T.');
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
  // Allison, Elizabeth Y. from the real workbook: expects 90.39 and an A.
  const store = newStore();
  const { course, a } = seedCourse(store);
  const [s] = store.addStudents(course.id, [{ studentId: '44305', fullName: 'Allison, Elizabeth Y.' }]);

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
  const [real] = store.addStudents(course.id, [{ studentId: '44305', fullName: 'Real, Student' }]);
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
  store.addStudents(course.id, [{ studentId: '44305', fullName: '' }]);

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
