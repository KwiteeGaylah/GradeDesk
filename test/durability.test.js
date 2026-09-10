'use strict';
/**
 * Data-safety tests.
 *
 * The promise this product makes is that a semester of grades is never lost.
 * Power cuts are a fact of life for the intended user, so these tests kill a
 * process outright mid-session and check what survived, rather than trusting
 * that "autosave" works.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { Store } = require('../src/data/store');

let dir;
test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-durability-'));
});
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Run a snippet in a child node process against a given database file. */
function runChild(file, body, { kill = false } = {}) {
  const script = path.join(dir, `child-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(
    script,
    `const { Store } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'data', 'store.js'))});
     const store = new Store(${JSON.stringify(file)});
     ${body}
     `,
    'utf8'
  );
  if (kill) {
    // Start it and terminate without letting it close the database.
    const res = spawnSync(process.execPath, [script], { timeout: 20000 });
    return res;
  }
  return execFileSync(process.execPath, [script], { encoding: 'utf8' });
}

test('a score is durable the instant it is entered, with no clean shutdown', () => {
  const file = path.join(dir, 'crash.db');

  // Write scores, then exit hard with process.kill: no close(), no flush, the
  // same as the machine losing power a keystroke after the score was typed.
  runChild(
    file,
    `const semester = store.createSemester('S1');
     const course = store.createCourse({ semesterId: semester.id, code: 'CSE 102' });
     const { byKind } = store.getTerms(course.id);
     const quiz = store.addAssessment(byKind.midterm.id, { name: 'Quiz 1', maxPoints: 15 });
     const [s] = store.addStudents(course.id, [{ studentId: '10001', fullName: 'Bestman, Comfort K.' }]);
     store.setScore(s.id, quiz.id, 12);
     process.kill(process.pid, 'SIGKILL');`,
    { kill: true }
  );

  // Reopen: the typed score must be there.
  const store = new Store(file);
  const scores = store.db.prepare('SELECT raw_value FROM scores').all();
  assert.equal(scores.length, 1, 'the score written before the kill must survive');
  assert.equal(scores[0].raw_value, 12);
  assert.equal(store.listSemesters().length, 1);
  store.close();
});

test('a killed process leaves a readable database, not a corrupt one', () => {
  const file = path.join(dir, 'integrity.db');
  runChild(
    file,
    `const semester = store.createSemester('S1');
     const course = store.createCourse({ semesterId: semester.id, code: 'X' });
     const { byKind } = store.getTerms(course.id);
     const a = store.addAssessment(byKind.midterm.id, { name: 'Q', maxPoints: 10 });
     const students = store.addStudents(course.id, Array.from({ length: 40 }, (_, i) => ({ fullName: 'S' + i })));
     for (const s of students) store.setScore(s.id, a.id, 7);
     process.kill(process.pid, 'SIGKILL');`,
    { kill: true }
  );

  const store = new Store(file);
  const integrity = store.db.pragma('integrity_check', { simple: true });
  assert.equal(integrity, 'ok', 'the database must pass an integrity check after a hard kill');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 40);
  store.close();
});

test('an interrupted transaction leaves no half-written batch', () => {
  const file = path.join(dir, 'atomic.db');
  // A transaction that throws part-way must roll back entirely.
  const store = new Store(file);
  const semester = store.createSemester('S1');
  const course = store.createCourse({ semesterId: semester.id, code: 'X' });
  const { byKind } = store.getTerms(course.id);
  const a = store.addAssessment(byKind.midterm.id, { name: 'Q', maxPoints: 10 });
  const students = store.addStudents(course.id, [{ fullName: 'A' }, { fullName: 'B' }]);

  assert.throws(() => {
    store.transaction(() => {
      store.setScore(students[0].id, a.id, 5);
      throw new Error('interrupted');
    });
  }, /interrupted/);

  assert.equal(store.getScore(students[0].id, a.id), null, 'the partial write must roll back');
  store.close();
});

test('reopening after a kill preserves every table, not just scores', () => {
  const file = path.join(dir, 'full.db');
  runChild(
    file,
    `const semester = store.createSemester('2026 Sem 1');
     const course = store.createCourse({ semesterId: semester.id, code: 'CSE 102', policy: '70' });
     const { byKind } = store.getTerms(course.id);
     const att = store.addAssessment(byKind.midterm.id, { name: 'Attendance', maxPoints: 10, kind: 'attendance' });
     const [s] = store.addStudents(course.id, [{ fullName: 'Marked, Student' }]);
     const session = store.addSession(course.id, byKind.midterm.id, '2026-09-02');
     store.setMark(s.id, session.id, 'P');
     process.kill(process.pid, 'SIGKILL');`,
    { kill: true }
  );

  const store = new Store(file);
  assert.equal(store.listSemesters().length, 1);
  const course = store.listCourses(store.getActiveSemester().id)[0];
  assert.ok(course, 'the course survived');
  const { byKind } = store.getTerms(course.id);
  assert.equal(store.listSessions(byKind.midterm.id).length, 1, 'the session survived');
  const student = store.listStudents(course.id)[0];
  assert.equal(store.getMark(student.id, store.listSessions(byKind.midterm.id)[0].id), 'P');
  store.close();
});
