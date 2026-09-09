-- GradeDesk schema. Appendix B of the PRD, made relational.
--
-- Design notes:
--  * Every foreign key cascades on delete, so removing a course cannot orphan
--    scores. Deleting is always deliberate and always warned about in the UI.
--  * A score's raw_value is nullable and NULL means blank, which is a real,
--    meaningful state in this domain (it transmutes to 50, and for an exam it
--    forces the letter "I"). It is never conflated with 0.
--  * Exactly one semester is active. Enforced by a partial unique index rather
--    than application code, so it holds even if a write path is added later.
--  * Assessment order is explicit so the UI and the export keep a stable,
--    instructor-chosen column order.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS semesters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  archived_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- At most one active semester, enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS idx_semesters_one_active
  ON semesters (is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL DEFAULT '',
  section     TEXT    NOT NULL DEFAULT '',
  instructor  TEXT    NOT NULL DEFAULT '',
  policy      TEXT    NOT NULL DEFAULT '70' CHECK (policy IN ('50', '60', '70')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_courses_semester ON courses (semester_id);

CREATE TABLE IF NOT EXISTS students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  number     INTEGER,
  student_id TEXT    NOT NULL DEFAULT '',
  full_name  TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_students_course ON students (course_id, sort_order);

CREATE TABLE IF NOT EXISTS terms (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind      TEXT    NOT NULL CHECK (kind IN ('midterm', 'final')),
  UNIQUE (course_id, kind)
);

CREATE TABLE IF NOT EXISTS assessments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id    INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  max_points INTEGER NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'class_standing'
             CHECK (kind IN ('class_standing', 'exam', 'attendance')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_assessments_term ON assessments (term_id, sort_order);

-- One exam per term. The exam is fixed at 40 points and is weighted, never
-- averaged, so a second one would silently change every grade in the course.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessments_one_exam
  ON assessments (term_id) WHERE kind = 'exam';

CREATE TABLE IF NOT EXISTS scores (
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  raw_value     REAL,   -- NULL means blank, which is meaningful. Never 0.
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, assessment_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_assessment ON scores (assessment_id);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term_id    INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions (course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sessions_term ON sessions (term_id, sort_order);

CREATE TABLE IF NOT EXISTS marks (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  code       TEXT,   -- 'P' | 'E' | anything else = 0. NULL means not taken.
  PRIMARY KEY (student_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_marks_session ON marks (session_id);

-- Schema version, for future migrations.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
