'use strict';
/**
 * Upgrading a version 1 database to the version 2 name columns.
 *
 * This is the test that matters most to an instructor who is already using
 * GradeDesk: they have a semester of real grades in a file written by version
 * 1, and installing the new build must not cost them any of it.
 *
 * Version 1 stored one `full_name` per student. Version 2 stores the four
 * columns of the administration's official class list — Student ID, Last Name,
 * First Name, Middle Name — so a list can be pasted straight in and the roster
 * can be sorted by surname or given name.
 *
 * The upgrade is additive and runs by itself on first launch. What is proven
 * here: names split correctly, nothing else is touched, every grade still
 * computes to the same number, a hand correction is never overwritten, and a
 * database that has already been upgraded is left alone.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { Store } = require('../src/data/store');
const { computeCourse } = require('../src/data/gradebook');
const { TransmutationTables } = require('../src/engine');

const tables = new TransmutationTables(require('../data/transmutation_tables.json'));

let tmpDir;
test.before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-migration-'));
});
test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write a database with the exact version 1 students table: no name parts.
 *
 * Built by hand rather than by checking out the old code, so the test keeps
 * describing the shape that is actually out there in instructors' files.
 */
function writeV1Database(name, students) {
  const file = path.join(tmpDir, name);
  const db = new Database(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0, archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
      code TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      section TEXT NOT NULL DEFAULT '', instructor TEXT NOT NULL DEFAULT '',
      policy TEXT NOT NULL DEFAULT '70', sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      number INTEGER, student_id TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
      unofficial INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '');
    CREATE TABLE terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, UNIQUE (course_id, kind));
    CREATE TABLE assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      name TEXT NOT NULL, max_points INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'class_standing', sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE scores (
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      raw_value REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (student_id, assessment_id));
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      date TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE marks (
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      code TEXT, PRIMARY KEY (student_id, session_id));
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    INSERT INTO meta (key, value) VALUES ('schema_version', '1');
    INSERT INTO semesters (name, is_active) VALUES ('2025–2026 Semester 1', 1);
    INSERT INTO courses (semester_id, code, name, policy)
      VALUES (1, 'CSE 102', 'Computer Literacy', '70');
    INSERT INTO terms (course_id, kind) VALUES (1, 'midterm'), (1, 'final');
    INSERT INTO assessments (term_id, name, max_points, kind, sort_order) VALUES
      (1, 'Quiz 1', 15, 'class_standing', 0),
      (1, 'Midterm Exam', 40, 'exam', 99),
      (2, 'Quiz 2', 15, 'class_standing', 0),
      (2, 'Final Exam', 40, 'exam', 99);
  `);

  const insert = db.prepare(
    'INSERT INTO students (course_id, number, student_id, full_name, sort_order) VALUES (1, ?, ?, ?, ?)'
  );
  const score = db.prepare(
    'INSERT INTO scores (student_id, assessment_id, raw_value) VALUES (?, ?, ?)'
  );
  students.forEach((s, i) => {
    const info = insert.run(i + 1, s.studentId, s.fullName, i);
    // A full set of scores, so the migration has real grades to leave alone.
    score.run(info.lastInsertRowid, 1, s.quiz1);
    score.run(info.lastInsertRowid, 2, s.midExam);
    score.run(info.lastInsertRowid, 3, s.quiz2);
    score.run(info.lastInsertRowid, 4, s.finExam);
  });
  db.close();
  return file;
}

const V1_STUDENTS = [
  { studentId: '10001', fullName: 'Bestman, Comfort K.', quiz1: 12, midExam: 33, quiz2: 14, finExam: 36 },
  { studentId: '10002', fullName: 'Van Der Berg, Anna Marie', quiz1: 9, midExam: 28, quiz2: 11, finExam: 30 },
  { studentId: '10003', fullName: 'Dolo, Patience', quiz1: 15, midExam: 40, quiz2: 15, finExam: 39 },
  // No comma: version 1 accepted it and stored it verbatim.
  { studentId: '10004', fullName: 'Nyema P. Ernest', quiz1: 7, midExam: 20, quiz2: 8, finExam: 22 },
  // An empty row, which an instructor leaves behind after adding spare rows.
  { studentId: '', fullName: '', quiz1: null, midExam: null, quiz2: null, finExam: null },
];

/** The grades a version 1 file produces, read before any upgrade happens. */
function gradesFrom(store, courseId) {
  const result = computeCourse(store, courseId, tables);
  return result.students.map((r) => ({
    id: r.student.id,
    grade: r.finalGradeDisplay,
    letter: r.letter,
  }));
}

test('upgrading splits every stored name into its parts', () => {
  const file = writeV1Database('split.db', V1_STUDENTS);
  const store = new Store(file);
  const rows = store.listStudents(1);

  const byId = (sid) => rows.find((r) => r.student_id === sid);
  assert.deepEqual(
    { l: byId('10001').last_name, f: byId('10001').first_name, m: byId('10001').middle_name },
    { l: 'Bestman', f: 'Comfort', m: 'K.' }
  );
  // A multi-word surname before the comma stays whole.
  assert.deepEqual(
    { l: byId('10002').last_name, f: byId('10002').first_name, m: byId('10002').middle_name },
    { l: 'Van Der Berg', f: 'Anna', m: 'Marie' }
  );
  assert.deepEqual(
    { l: byId('10003').last_name, f: byId('10003').first_name, m: byId('10003').middle_name },
    { l: 'Dolo', f: 'Patience', m: '' }
  );
  // No comma: the official list is surname-first, so the first word is taken
  // as the surname.
  assert.deepEqual(
    { l: byId('10004').last_name, f: byId('10004').first_name, m: byId('10004').middle_name },
    { l: 'Nyema', f: 'P.', m: 'Ernest' }
  );
  store.close();
});

test('the original written name is kept, so a bad split is always recoverable', () => {
  const file = writeV1Database('keep.db', V1_STUDENTS);
  const store = new Store(file);
  const rows = store.listStudents(1);
  // "Nyema P. Ernest" is the judgement call. Whatever the splitter decided,
  // the string the instructor actually typed is still on the row.
  const original = rows.find((r) => r.student_id === '10004');
  assert.equal(original.full_name, 'Nyema P. Ernest');
  store.close();
});

test('an empty roster row is left empty rather than invented', () => {
  const file = writeV1Database('empty.db', V1_STUDENTS);
  const store = new Store(file);
  const blank = store.listStudents(1).find((r) => r.student_id === '');
  assert.deepEqual(
    { l: blank.last_name, f: blank.first_name, m: blank.middle_name, full: blank.full_name },
    { l: '', f: '', m: '', full: '' }
  );
  store.close();
});

test('every grade survives the upgrade unchanged', () => {
  const file = writeV1Database('grades.db', V1_STUDENTS);

  // Opening the file runs the migration, so the "before" reading is taken from
  // the raw scores rather than from a pre-migration Store.
  const raw = new Database(file);
  const beforeScores = raw
    .prepare('SELECT student_id, assessment_id, raw_value FROM scores ORDER BY student_id, assessment_id')
    .all();
  const beforeStudents = raw
    .prepare('SELECT id, number, student_id, full_name, sort_order FROM students ORDER BY id')
    .all();
  raw.close();

  const store = new Store(file);
  const afterScores = store.db
    .prepare('SELECT student_id, assessment_id, raw_value FROM scores ORDER BY student_id, assessment_id')
    .all();
  const afterStudents = store.db
    .prepare('SELECT id, number, student_id, full_name, sort_order FROM students ORDER BY id')
    .all();

  assert.deepEqual(afterScores, beforeScores, 'not one score is touched');
  assert.deepEqual(afterStudents, beforeStudents, 'ids, numbers and order are unchanged');

  // And the grades still compute.
  const grades = gradesFrom(store, 1);
  assert.equal(grades.length, V1_STUDENTS.length);
  assert.ok(grades.every((g) => typeof g.grade === 'string'), 'every student still has a grade');
  store.close();
});

test('the schema version is updated, not left reading as version 1', () => {
  const file = writeV1Database('version.db', V1_STUDENTS);
  const store = new Store(file);
  const version = store.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  assert.equal(version.value, '2');
  store.close();
});

test('a correction made by hand is not overwritten on the next launch', () => {
  const file = writeV1Database('correction.db', V1_STUDENTS);

  const first = new Store(file);
  const target = first.listStudents(1).find((r) => r.student_id === '10004');
  // The instructor fixes the one the splitter had to guess at: Ernest Nyema's
  // name was written given-name-first.
  first.updateStudent(target.id, { lastName: 'Nyema', firstName: 'Ernest', middleName: 'P.' });
  first.close();

  const second = new Store(file);
  const after = second.listStudents(1).find((r) => r.student_id === '10004');
  assert.deepEqual(
    { l: after.last_name, f: after.first_name, m: after.middle_name },
    { l: 'Nyema', f: 'Ernest', m: 'P.' },
    'reopening must not re-split over the correction'
  );
  // And the written name followed the correction.
  assert.equal(after.full_name, 'Nyema, Ernest P.');
  second.close();
});

test('upgrading twice is the same as upgrading once', () => {
  const file = writeV1Database('twice.db', V1_STUDENTS);
  const first = new Store(file);
  const once = first.listStudents(1);
  first.close();

  const second = new Store(file);
  const twice = second.listStudents(1);
  second.close();

  assert.deepEqual(twice, once);
});

test('a database created fresh already has the name columns', () => {
  const store = new Store(':memory:');
  const columns = store.db.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
  for (const col of ['last_name', 'first_name', 'middle_name', 'full_name']) {
    assert.ok(columns.includes(col), `a new database should have ${col}`);
  }
  store.close();
});

test('a backup made by version 1 restores with its names split', () => {
  // The flash-drive path: an instructor exports from the old version on one
  // machine and restores into the new one on another. There is no database to
  // migrate in that case — the rows arrive straight from JSON — so the restore
  // has to do the same splitting the upgrade does.
  const { importData } = require('../src/data/backup');
  const store = new Store(':memory:');

  const v1Backup = {
    format: 'gradedesk-backup',
    version: 1,
    data: {
      semesters: [{ id: 1, name: '2025-2026 Sem 1', is_active: 1, archived_at: null, created_at: '2025-09-01' }],
      courses: [{
        id: 1, semester_id: 1, code: 'CSE 102', name: 'Computer Literacy',
        section: '', instructor: '', policy: '70', sort_order: 0, created_at: '2025-09-01',
      }],
      // Exactly the version 1 student shape: no name-part columns at all.
      students: [
        { id: 1, course_id: 1, number: 1, student_id: '10001', full_name: 'Bestman, Comfort K.', sort_order: 0, unofficial: 0, note: '' },
        { id: 2, course_id: 1, number: 2, student_id: '10002', full_name: 'Dolo, Patience', sort_order: 1, unofficial: 0, note: '' },
      ],
      terms: [{ id: 1, course_id: 1, kind: 'midterm' }, { id: 2, course_id: 1, kind: 'final' }],
    },
  };

  importData(store, v1Backup);
  const rows = store.listStudents(1);
  assert.deepEqual(
    rows.map((r) => [r.last_name, r.first_name, r.middle_name]),
    [['Bestman', 'Comfort', 'K.'], ['Dolo', 'Patience', '']]
  );
  // And the written names are untouched.
  assert.equal(rows[0].full_name, 'Bestman, Comfort K.');
  store.close();
});

test('restoring a current backup preserves a hand-corrected name', () => {
  const { exportData, importData } = require('../src/data/backup');
  const source = new Store(':memory:');
  const semester = source.createSemester('2026-2027 Sem 1');
  const course = source.createCourse({ semesterId: semester.id, code: 'CSE 102', policy: '70' });
  // A name the splitter would read differently from how the instructor wants it.
  source.addStudent(course.id, {
    studentId: '10004', lastName: 'Nyema', firstName: 'Ernest', middleName: 'P.',
  });
  const payload = exportData(source);
  source.close();

  const target = new Store(':memory:');
  importData(target, payload);
  const restored = target.listStudents(course.id)[0];
  assert.deepEqual(
    [restored.last_name, restored.first_name, restored.middle_name],
    ['Nyema', 'Ernest', 'P.'],
    'the backfill must not re-split a name that already has parts'
  );
  target.close();
});
