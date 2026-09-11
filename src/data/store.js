'use strict';
/**
 * GradeDesk data store.
 *
 * A single SQLite file on the instructor's machine. Every write commits
 * immediately, so "autosave" is not a timer that can lose a keystroke — the
 * score is durable the moment it leaves the input. WAL journalling plus
 * synchronous=FULL means a power cut mid-typing costs nothing already entered,
 * which matters where the power is unreliable.
 *
 * This layer knows about storage, not grading. It hands raw scores to the
 * engine and stores what comes back from the instructor; it never computes a
 * grade itself.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SCHEMA_VERSION = '1';

/** Terms every course has, in display order. */
const TERM_KINDS = ['midterm', 'final'];

/** The exam is fixed at 40 points by university policy. */
const EXAM_MAX_POINTS = 40;

class Store {
  /**
   * @param {string} filePath  path to the .gradedesk database file, or ':memory:'
   */
  constructor(filePath) {
    this.filePath = filePath;
    if (filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    // Durability over speed: an instructor's typed score must survive a crash.
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    this._migrate();
    this.db
      .prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
      .run('schema_version', SCHEMA_VERSION);
  }

  /**
   * Bring an older database up to the current shape.
   *
   * The schema is written with CREATE TABLE IF NOT EXISTS, so a table that
   * already exists is left exactly as it was. Columns added after a release
   * therefore have to be applied here, or an instructor who upgrades keeps the
   * old shape and the app breaks on the missing column.
   */
  _migrate() {
    const columns = (table) =>
      this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

    const studentCols = columns('students');
    if (!studentCols.includes('unofficial')) {
      this.db.exec(
        "ALTER TABLE students ADD COLUMN unofficial INTEGER NOT NULL DEFAULT 0"
      );
    }
    if (!studentCols.includes('note')) {
      this.db.exec("ALTER TABLE students ADD COLUMN note TEXT NOT NULL DEFAULT ''");
    }
  }

  close() {
    this.db.close();
  }

  /** Run a function inside a transaction. All-or-nothing. */
  transaction(fn) {
    return this.db.transaction(fn)();
  }

  // ------------------------------------------------------------- semesters

  /**
   * Create a semester. When `activate` is true (the default) this becomes the
   * active semester and the previously active one is archived — the PRD's
   * "creating a new one archives the previous" rule, done atomically.
   */
  createSemester(name, { activate = true } = {}) {
    return this.transaction(() => {
      if (activate) this._archiveActive();
      const info = this.db
        .prepare('INSERT INTO semesters (name, is_active) VALUES (?, ?)')
        .run(name, activate ? 1 : 0);
      return this.getSemester(info.lastInsertRowid);
    });
  }

  /** Archive whichever semester is currently active, if any. */
  _archiveActive() {
    this.db
      .prepare(
        `UPDATE semesters
            SET is_active = 0,
                archived_at = COALESCE(archived_at, datetime('now'))
          WHERE is_active = 1`
      )
      .run();
  }

  /**
   * Make an existing semester active, archiving the current one.
   * Reactivating an archived semester clears its archived_at.
   */
  activateSemester(semesterId) {
    return this.transaction(() => {
      const target = this.getSemester(semesterId);
      if (!target) throw new Error(`No semester with id ${semesterId}`);
      this._archiveActive();
      this.db
        .prepare('UPDATE semesters SET is_active = 1, archived_at = NULL WHERE id = ?')
        .run(semesterId);
      return this.getSemester(semesterId);
    });
  }

  getSemester(id) {
    return this.db.prepare('SELECT * FROM semesters WHERE id = ?').get(id) || null;
  }

  getActiveSemester() {
    return this.db.prepare('SELECT * FROM semesters WHERE is_active = 1').get() || null;
  }

  listSemesters() {
    return this.db
      .prepare('SELECT * FROM semesters ORDER BY is_active DESC, created_at DESC, id DESC')
      .all();
  }

  renameSemester(id, name) {
    this.db.prepare('UPDATE semesters SET name = ? WHERE id = ?').run(name, id);
    return this.getSemester(id);
  }

  deleteSemester(id) {
    this.db.prepare('DELETE FROM semesters WHERE id = ?').run(id);
  }

  // ---------------------------------------------------------------- courses

  /**
   * Create a course under a semester. Both terms are created automatically,
   * each with its fixed 40-point exam, because no course is valid without them.
   */
  createCourse({
    semesterId,
    code,
    name = '',
    section = '',
    instructor = '',
    policy = '70',
    createExams = true,
  }) {
    return this.transaction(() => {
      const order = this.db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM courses WHERE semester_id = ?')
        .get(semesterId).n;
      const info = this.db
        .prepare(
          `INSERT INTO courses (semester_id, code, name, section, instructor, policy, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(semesterId, code, name, section, instructor, String(policy), order);
      const courseId = info.lastInsertRowid;

      for (const kind of TERM_KINDS) {
        const termInfo = this.db
          .prepare('INSERT INTO terms (course_id, kind) VALUES (?, ?)')
          .run(courseId, kind);
        if (createExams) {
          this.db
            .prepare(
              `INSERT INTO assessments (term_id, name, max_points, kind, sort_order)
               VALUES (?, ?, ?, 'exam', 999)`
            )
            .run(termInfo.lastInsertRowid, kind === 'midterm' ? 'Midterm Exam' : 'Final Exam', EXAM_MAX_POINTS);
        }
      }
      return this.getCourse(courseId);
    });
  }

  getCourse(id) {
    return this.db.prepare('SELECT * FROM courses WHERE id = ?').get(id) || null;
  }

  listCourses(semesterId) {
    return this.db
      .prepare('SELECT * FROM courses WHERE semester_id = ? ORDER BY sort_order, id')
      .all(semesterId);
  }

  updateCourse(id, fields) {
    const allowed = ['code', 'name', 'section', 'instructor', 'policy', 'sort_order'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.getCourse(id);
    const set = keys.map((k) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE courses SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    return this.getCourse(id);
  }

  deleteCourse(id) {
    this.db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  }

  /** Terms of a course, keyed by kind for convenience. */
  getTerms(courseId) {
    const rows = this.db
      .prepare('SELECT * FROM terms WHERE course_id = ? ORDER BY CASE kind WHEN \'midterm\' THEN 0 ELSE 1 END')
      .all(courseId);
    const byKind = {};
    for (const r of rows) byKind[r.kind] = r;
    return { list: rows, byKind };
  }

  // --------------------------------------------------------------- students

  addStudent(courseId, { number = null, studentId = '', fullName = '', unofficial = 0, note = '' } = {}) {
    const order = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM students WHERE course_id = ?')
      .get(courseId).n;
    const resolvedNumber = number === null || number === undefined ? order + 1 : number;
    const info = this.db
      .prepare(
        `INSERT INTO students (course_id, number, student_id, full_name, sort_order, unofficial, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(courseId, resolvedNumber, studentId, fullName, order, unofficial ? 1 : 0, note);
    return this.getStudent(info.lastInsertRowid);
  }

  /** Add many students at once, e.g. a typed or pasted roster. */
  addStudents(courseId, rows) {
    return this.transaction(() => rows.map((r) => this.addStudent(courseId, r)));
  }

  getStudent(id) {
    return this.db.prepare('SELECT * FROM students WHERE id = ?').get(id) || null;
  }

  listStudents(courseId) {
    return this.db
      .prepare('SELECT * FROM students WHERE course_id = ? ORDER BY sort_order, id')
      .all(courseId);
  }

  updateStudent(id, fields) {
    const map = {
      number: 'number',
      studentId: 'student_id',
      fullName: 'full_name',
      sortOrder: 'sort_order',
      unofficial: 'unofficial',
      note: 'note',
    };
    const keys = Object.keys(fields).filter((k) => map[k]);
    if (!keys.length) return this.getStudent(id);
    const set = keys.map((k) => `${map[k]} = ?`).join(', ');
    const values = keys.map((k) => (k === 'unofficial' ? (fields[k] ? 1 : 0) : fields[k]));
    this.db.prepare(`UPDATE students SET ${set} WHERE id = ?`).run(...values, id);
    return this.getStudent(id);
  }

  deleteStudent(id) {
    this.db.prepare('DELETE FROM students WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ assessments

  /**
   * Add an assessment to a term. The caller validates max_points against the
   * course policy (see engine/policy.validateMaxPoints) — the store records
   * what it is told, so a deliberate override remains possible.
   */
  addAssessment(termId, { name, maxPoints, kind = 'class_standing', sortOrder = null }) {
    const order =
      sortOrder === null
        ? this.db
            .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM assessments WHERE term_id = ? AND kind != \'exam\'')
            .get(termId).n
        : sortOrder;
    const points = kind === 'exam' ? EXAM_MAX_POINTS : maxPoints;
    const info = this.db
      .prepare(
        `INSERT INTO assessments (term_id, name, max_points, kind, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(termId, name, points, kind, order);
    return this.getAssessment(info.lastInsertRowid);
  }

  getAssessment(id) {
    return this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) || null;
  }

  /** Assessments of a term, class standing first in order, exam last. */
  listAssessments(termId) {
    return this.db
      .prepare(
        `SELECT * FROM assessments
          WHERE term_id = ?
          ORDER BY CASE kind WHEN 'exam' THEN 1 ELSE 0 END, sort_order, id`
      )
      .all(termId);
  }

  /** The class-standing assessments of a term: everything that is not the exam. */
  listClassStandingAssessments(termId) {
    return this.listAssessments(termId).filter((a) => a.kind !== 'exam');
  }

  getExam(termId) {
    return (
      this.db.prepare("SELECT * FROM assessments WHERE term_id = ? AND kind = 'exam'").get(termId) || null
    );
  }

  updateAssessment(id, fields) {
    const map = { name: 'name', maxPoints: 'max_points', kind: 'kind', sortOrder: 'sort_order' };
    const keys = Object.keys(fields).filter((k) => map[k]);
    if (!keys.length) return this.getAssessment(id);
    const current = this.getAssessment(id);
    // The exam maximum is fixed; ignore any attempt to change it.
    if (current && current.kind === 'exam' && fields.maxPoints !== undefined) {
      fields = { ...fields, maxPoints: EXAM_MAX_POINTS };
    }
    const set = keys.map((k) => `${map[k]} = ?`).join(', ');
    this.db.prepare(`UPDATE assessments SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    return this.getAssessment(id);
  }

  /** How many entered scores an assessment has, so the UI can warn before deleting. */
  countScores(assessmentId) {
    return this.db
      .prepare('SELECT COUNT(*) AS n FROM scores WHERE assessment_id = ? AND raw_value IS NOT NULL')
      .get(assessmentId).n;
  }

  deleteAssessment(id) {
    this.db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
  }

  // -------------------------------------------------------------- presets

  /**
   * Save a term's assessments as a reusable preset.
   *
   * Structure only: names, point values and order. Never scores, and never the
   * exam, which every term already has and which is fixed at 40.
   *
   * A preset is a template rather than something grades are computed from, so
   * it deliberately holds no link back to the course it came from. Deleting
   * that course later must not disturb it.
   *
   * Names are unique. Saving over an existing name replaces its contents
   * rather than creating a second preset that looks identical in the picker.
   */
  savePreset(name, items) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('A preset needs a name.');

    const rows = (Array.isArray(items) ? items : [])
      .filter((a) => a && a.kind !== 'exam')
      .map((a) => ({
        name: String(a.name || '').trim(),
        maxPoints: Number(a.maxPoints ?? a.max_points),
        kind: a.kind === 'attendance' ? 'attendance' : 'class_standing',
      }))
      .filter((a) => a.name && Number.isFinite(a.maxPoints));

    if (!rows.length) throw new Error('There are no assessments to save.');

    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM presets WHERE name = ?').get(clean);
      let presetId;
      if (existing) {
        presetId = existing.id;
        this.db.prepare('DELETE FROM preset_items WHERE preset_id = ?').run(presetId);
      } else {
        presetId = this.db.prepare('INSERT INTO presets (name) VALUES (?)').run(clean).lastInsertRowid;
      }
      const insert = this.db.prepare(
        `INSERT INTO preset_items (preset_id, name, max_points, kind, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      );
      rows.forEach((a, i) => insert.run(presetId, a.name, a.maxPoints, a.kind, i));
      return this.getPreset(presetId);
    });
  }

  /** One saved preset with its rows, or null. */
  getPreset(id) {
    const preset = this.db.prepare('SELECT * FROM presets WHERE id = ?').get(id);
    if (!preset) return null;
    return { ...preset, items: this._presetItems(id) };
  }

  _presetItems(presetId) {
    return this.db
      .prepare('SELECT * FROM preset_items WHERE preset_id = ? ORDER BY sort_order, id')
      .all(presetId);
  }

  /** Every saved preset, each with its rows, newest name order. */
  listPresets() {
    return this.db
      .prepare('SELECT * FROM presets ORDER BY name COLLATE NOCASE')
      .all()
      .map((p) => ({ ...p, items: this._presetItems(p.id) }));
  }

  /** Rename a saved preset. Throws if the new name is taken. */
  renamePreset(id, name) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('A preset needs a name.');
    const clash = this.db
      .prepare('SELECT id FROM presets WHERE name = ? AND id != ?')
      .get(clean, id);
    if (clash) throw new Error(`There is already a preset called "${clean}".`);
    this.db.prepare('UPDATE presets SET name = ? WHERE id = ?').run(clean, id);
    return this.getPreset(id);
  }

  /** Delete a saved preset. Its rows go with it, by cascade. */
  deletePreset(id) {
    this.db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  }

  /**
   * Put a term's class-standing assessments in the given order.
   *
   * Takes the full ordered list of ids rather than a move-one-step call, so a
   * drag that lands three rows down is still one write.
   *
   * The exam is never included: listAssessments always sorts it last by kind,
   * so its sort_order is not meaningful. Ids that do not belong to this term
   * are ignored rather than trusted, since this arrives from the renderer.
   */
  reorderAssessments(termId, orderedIds) {
    return this.transaction(() => {
      const mine = new Set(
        this.db
          .prepare("SELECT id FROM assessments WHERE term_id = ? AND kind != 'exam'")
          .all(termId)
          .map((r) => r.id)
      );
      const update = this.db.prepare('UPDATE assessments SET sort_order = ? WHERE id = ?');
      let order = 0;
      for (const id of orderedIds) {
        if (!mine.has(id)) continue;
        update.run(order, id);
        order += 1;
      }
      return this.listAssessments(termId);
    });
  }

  /**
   * Copy the class-standing assessments of one term into another.
   *
   * Structure only: names and point values, never scores. Copying marks across
   * terms would invent grades nobody entered.
   *
   * Skips any assessment whose name already exists in the target, so running it
   * twice does not double everything. Attendance is copied at most once,
   * because a term with two attendance rows would count it twice in the
   * average. The exam is never copied; every term already has exactly one and
   * a second would break the one-exam index.
   */
  copyAssessmentsToTerm(fromTermId, toTermId) {
    return this.transaction(() => {
      const existing = this.listAssessments(toTermId);
      const taken = new Set(existing.map((a) => a.name.trim().toLowerCase()));
      let attendanceUsed = existing.some((a) => a.kind === 'attendance');

      let copied = 0;
      for (const a of this.listClassStandingAssessments(fromTermId)) {
        if (taken.has(a.name.trim().toLowerCase())) continue;
        if (a.kind === 'attendance') {
          if (attendanceUsed) continue;
          attendanceUsed = true;
        }
        this.addAssessment(toTermId, { name: a.name, maxPoints: a.max_points, kind: a.kind });
        // Deliberately NOT added to `taken`: a term holding two assessments
        // with the same name is legitimate, and adding it here copied only the
        // first of them.
        copied += 1;
      }
      return { copied, assessments: this.listAssessments(toTermId) };
    });
  }

  /**
   * Create a new course carrying another's assessment structure.
   *
   * Deliberately copies NOTHING else. No students, no scores, no attendance
   * sessions or marks: those belong to the class that sat the course, not to
   * its shape. Someone duplicating "CSE 102 section 1" to make section 2 wants
   * the same quizzes, not the same people or the same marks.
   *
   * createCourse already makes both terms and both exams, so only the
   * class-standing rows are copied in.
   */
  duplicateCourse(sourceId, overrides = {}) {
    return this.transaction(() => {
      const source = this.getCourse(sourceId);
      if (!source) throw new Error('Course not found');

      const course = this.createCourse({
        semesterId: overrides.semesterId ?? source.semester_id,
        code: overrides.code ?? source.code,
        name: overrides.name ?? source.name,
        section: overrides.section ?? source.section,
        instructor: overrides.instructor ?? source.instructor,
        policy: overrides.policy ?? source.policy,
      });

      const from = this.getTerms(sourceId).byKind;
      const to = this.getTerms(course.id).byKind;
      for (const kind of TERM_KINDS) {
        if (from[kind] && to[kind]) this.copyAssessmentsToTerm(from[kind].id, to[kind].id);
      }
      return course;
    });
  }

  // -------------------------------------------------------------------scores

  /**
   * Set one raw score. Passing null clears it back to blank, which is a real
   * state, not a deletion. Commits immediately.
   */
  setScore(studentId, assessmentId, rawValue) {
    const value = rawValue === '' || rawValue === undefined ? null : rawValue;
    this.db
      .prepare(
        `INSERT INTO scores (student_id, assessment_id, raw_value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT (student_id, assessment_id)
         DO UPDATE SET raw_value = excluded.raw_value, updated_at = excluded.updated_at`
      )
      .run(studentId, assessmentId, value);
  }

  /** Set many scores in one transaction, e.g. a pasted column. */
  setScores(entries) {
    return this.transaction(() => {
      for (const e of entries) this.setScore(e.studentId, e.assessmentId, e.rawValue);
    });
  }

  getScore(studentId, assessmentId) {
    const row = this.db
      .prepare('SELECT raw_value FROM scores WHERE student_id = ? AND assessment_id = ?')
      .get(studentId, assessmentId);
    return row ? row.raw_value : null;
  }

  /** All scores for one assessment, as a Map of studentId -> raw value. */
  getScoresForAssessment(assessmentId) {
    const rows = this.db
      .prepare('SELECT student_id, raw_value FROM scores WHERE assessment_id = ?')
      .all(assessmentId);
    const map = new Map();
    for (const r of rows) map.set(r.student_id, r.raw_value);
    return map;
  }

  /** Every score in a course, as Map of `${studentId}:${assessmentId}` -> raw. */
  getScoresForCourse(courseId) {
    const rows = this.db
      .prepare(
        `SELECT s.student_id, s.assessment_id, s.raw_value
           FROM scores s
           JOIN assessments a ON a.id = s.assessment_id
           JOIN terms t       ON t.id = a.term_id
          WHERE t.course_id = ?`
      )
      .all(courseId);
    const map = new Map();
    for (const r of rows) map.set(`${r.student_id}:${r.assessment_id}`, r.raw_value);
    return map;
  }

  // ---------------------------------------------------- attendance sessions

  /**
   * Add an attendance session.
   *
   * A class meets once on a given day, so the same date cannot be added twice
   * to a course: a duplicate would quietly double that day's weight in every
   * student's attendance score. Past dates are allowed and expected, since
   * attendance is often entered days later from a paper register.
   *
   * @throws {Error} when the date already exists in this course
   */
  addSession(courseId, termId, date) {
    const day = String(date).trim();
    if (!day) throw new Error('A session needs a date.');

    const clash = this.db
      .prepare('SELECT s.id, t.kind FROM sessions s JOIN terms t ON t.id = s.term_id WHERE s.course_id = ? AND s.date = ?')
      .get(courseId, day);
    if (clash) {
      throw new Error(
        `There is already a session on ${day} in the ${clash.kind} term. ` +
          'Each class meeting is recorded once.'
      );
    }

    const order = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM sessions WHERE term_id = ?')
      .get(termId).n;
    const info = this.db
      .prepare('INSERT INTO sessions (course_id, term_id, date, sort_order) VALUES (?, ?, ?, ?)')
      .run(courseId, termId, day, order);
    return this.getSession(info.lastInsertRowid);
  }

  getSession(id) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
  }

  /**
   * Sessions of a term in DATE order, not insertion order, so a back-dated
   * session added later still appears in the right column of the grid.
   */
  listSessions(termId) {
    return this.db
      .prepare('SELECT * FROM sessions WHERE term_id = ? ORDER BY date, id')
      .all(termId);
  }

  /** How many marks a session holds, so the UI can warn before removing it. */
  countMarks(sessionId) {
    return this.db
      .prepare('SELECT COUNT(*) AS n FROM marks WHERE session_id = ? AND code IS NOT NULL')
      .get(sessionId).n;
  }

  deleteSession(id) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Set one attendance mark. null clears it, meaning the session was not taken. */
  setMark(studentId, sessionId, code) {
    const value = code === '' || code === undefined ? null : code;
    this.db
      .prepare(
        `INSERT INTO marks (student_id, session_id, code)
         VALUES (?, ?, ?)
         ON CONFLICT (student_id, session_id)
         DO UPDATE SET code = excluded.code`
      )
      .run(studentId, sessionId, value);
  }

  getMark(studentId, sessionId) {
    const row = this.db
      .prepare('SELECT code FROM marks WHERE student_id = ? AND session_id = ?')
      .get(studentId, sessionId);
    return row ? row.code : null;
  }

  /**
   * Attendance marks for a term, as Map of studentId -> array of marks in
   * session order. Sessions with no row for a student come back as null,
   * which the engine treats as "not taken" and excludes from the denominator.
   */
  getMarksForTerm(termId) {
    const sessions = this.listSessions(termId);
    const rows = this.db
      .prepare(
        `SELECT m.student_id, m.session_id, m.code
           FROM marks m
           JOIN sessions s ON s.id = m.session_id
          WHERE s.term_id = ?`
      )
      .all(termId);
    const bySession = new Map();
    for (const r of rows) bySession.set(`${r.student_id}:${r.session_id}`, r.code);

    const byStudent = new Map();
    for (const student of this.db
      .prepare(
        `SELECT st.id FROM students st
           JOIN terms t ON t.course_id = st.course_id
          WHERE t.id = ?
          ORDER BY st.sort_order, st.id`
      )
      .all(termId)) {
      byStudent.set(
        student.id,
        sessions.map((s) => {
          const v = bySession.get(`${student.id}:${s.id}`);
          return v === undefined ? null : v;
        })
      );
    }
    return { sessions, byStudent };
  }
}

module.exports = { Store, TERM_KINDS, EXAM_MAX_POINTS, SCHEMA_VERSION };
