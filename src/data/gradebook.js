'use strict';
/**
 * Gradebook — the bridge between stored data and the pure engine.
 *
 * Reads a course's students, assessments and scores out of the store, resolves
 * attendance into a raw score, and asks the engine to compute. The engine stays
 * pure and knows nothing about SQLite; this module does the joining.
 *
 * The result shape is what every screen and both exports render from, so the
 * numbers on screen and the numbers in the exported workbook cannot disagree.
 */

const {
  attendanceRaw,
  computeStudent,
  formatGrade,
  EXAM_MAX_POINTS,
} = require('../engine');

/**
 * Compute the whole class for one course.
 *
 * @param {Store} store
 * @param {number} courseId
 * @param {TransmutationTables} tables
 * @returns {{course, policy, terms, students: Array}}
 */
function computeCourse(store, courseId, tables) {
  const course = store.getCourse(courseId);
  if (!course) throw new Error(`No course with id ${courseId}`);
  const policy = String(course.policy);

  const { byKind } = store.getTerms(courseId);
  const students = store.listStudents(courseId);
  const scores = store.getScoresForCourse(courseId);

  const termInfo = {};
  for (const kind of ['midterm', 'final']) {
    const term = byKind[kind];
    if (!term) {
      termInfo[kind] = { term: null, classStanding: [], exam: null, attendance: new Map() };
      continue;
    }
    const classStanding = store.listClassStandingAssessments(term.id);
    const exam = store.getExam(term.id);

    // Attendance raw scores are derived from session marks, not typed.
    const attendanceAssessments = classStanding.filter((a) => a.kind === 'attendance');
    const attendance = new Map();
    if (attendanceAssessments.length) {
      const { byStudent } = store.getMarksForTerm(term.id);
      for (const a of attendanceAssessments) {
        const perStudent = new Map();
        for (const s of students) {
          perStudent.set(s.id, attendanceRaw(byStudent.get(s.id) || [], a.max_points));
        }
        attendance.set(a.id, perStudent);
      }
    }
    termInfo[kind] = { term, classStanding, exam, attendance };
  }

  const rawFor = (student, assessment, kind) => {
    if (assessment.kind === 'attendance') {
      const perStudent = termInfo[kind].attendance.get(assessment.id);
      return perStudent ? perStudent.get(student.id) : null;
    }
    const v = scores.get(`${student.id}:${assessment.id}`);
    return v === undefined ? null : v;
  };

  const rows = students.map((student) => {
    const midtermAssessments = termInfo.midterm.classStanding.map((a) => ({
      assessment: a,
      raw: rawFor(student, a, 'midterm'),
      maxPoints: a.max_points,
    }));
    const finalAssessments = termInfo.final.classStanding.map((a) => ({
      assessment: a,
      raw: rawFor(student, a, 'final'),
      maxPoints: a.max_points,
    }));

    const midtermExam = termInfo.midterm.exam;
    const finalExam = termInfo.final.exam;
    const midtermExamRaw = midtermExam
      ? (() => {
          const v = scores.get(`${student.id}:${midtermExam.id}`);
          return v === undefined ? null : v;
        })()
      : null;
    const finalExamRaw = finalExam
      ? (() => {
          const v = scores.get(`${student.id}:${finalExam.id}`);
          return v === undefined ? null : v;
        })()
      : null;

    const computed = computeStudent(
      {
        midtermAssessments: midtermAssessments.map((a) => ({ raw: a.raw, maxPoints: a.maxPoints })),
        midtermExamRaw,
        finalAssessments: finalAssessments.map((a) => ({ raw: a.raw, maxPoints: a.maxPoints })),
        finalExamRaw,
      },
      tables,
      policy
    );

    return {
      student,
      midterm: {
        assessments: midtermAssessments.map((a, i) => ({
          ...a,
          transmuted: computed.midtermTransmuted[i],
        })),
        examRaw: midtermExamRaw,
        examTransmuted: computed.midtermExamTransmuted,
        classStanding: computed.midtermClassStanding,
        total: computed.midtermTotal,
      },
      final: {
        assessments: finalAssessments.map((a, i) => ({
          ...a,
          transmuted: computed.finalTransmuted[i],
        })),
        examRaw: finalExamRaw,
        examTransmuted: computed.finalExamTransmuted,
        classStanding: computed.finalClassStanding,
        total: computed.finalTotal,
      },
      finalGrade: computed.finalGrade,
      finalGradeDisplay: computed.finalGradeDisplay,
      letter: computed.letter,
    };
  });

  return {
    course,
    policy,
    terms: {
      midterm: {
        term: termInfo.midterm.term,
        classStanding: termInfo.midterm.classStanding,
        exam: termInfo.midterm.exam,
      },
      final: {
        term: termInfo.final.term,
        classStanding: termInfo.final.classStanding,
        exam: termInfo.final.exam,
      },
    },
    students: rows,
  };
}

/**
 * Pre-export issue review (PRD 5.7). Surfaces what Excel would not catch.
 * Ordered by severity so the UI can show the blocking things first.
 *
 * @returns {Array<{severity:'error'|'warning'|'info', kind:string, message:string, student?:object}>}
 */
function reviewIssues(store, courseId, tables) {
  const result = computeCourse(store, courseId, tables);
  const issues = [];

  // A roster row with no name and no ID is a blank the instructor added and has
  // not filled in yet. Reporting it as a student with missing scores buries the
  // real problems under noise, so those rows are counted separately instead.
  const isBlankRow = (s) =>
    !String(s.full_name || '').trim() && !String(s.student_id || '').trim();
  const blankRows = result.students.filter((r) => isBlankRow(r.student));

  for (const row of result.students) {
    if (isBlankRow(row.student)) continue;
    const who = row.student.full_name || `Student ${row.student.number ?? row.student.id}`;

    for (const termKey of ['midterm', 'final']) {
      const term = row[termKey];
      const label = termKey === 'midterm' ? 'Midterm' : 'Final';

      // A raw score above the assessment maximum: a typo that inflates a grade.
      for (const a of term.assessments) {
        if (a.raw !== null && a.raw !== undefined && Number(a.raw) > a.maxPoints) {
          issues.push({
            severity: 'error',
            kind: 'score_above_max',
            student: row.student,
            message: `${who}: ${a.assessment.name} is ${a.raw}, above the maximum of ${a.maxPoints}.`,
          });
        }
      }
      if (term.examRaw !== null && Number(term.examRaw) > EXAM_MAX_POINTS) {
        issues.push({
          severity: 'error',
          kind: 'score_above_max',
          student: row.student,
          message: `${who}: ${label} exam is ${term.examRaw}, above the maximum of ${EXAM_MAX_POINTS}.`,
        });
      }
    }

    // A blank exam forces I regardless of everything else.
    if (row.letter === 'I') {
      const missing = [];
      if (row.midterm.examRaw === null) missing.push('midterm exam');
      if (row.final.examRaw === null) missing.push('final exam');
      issues.push({
        severity: 'warning',
        kind: 'blank_exam',
        student: row.student,
        message: `${who} has no ${missing.join(' and no ')}, so the letter grade is I.`,
      });
    }

    if (row.letter === 'NG') {
      issues.push({
        severity: 'error',
        kind: 'no_grade',
        student: row.student,
        message: `${who}: the final grade cannot be computed (NG). Check that both terms have assessments.`,
      });
    }

    // Blank class-standing scores silently count as 50, which is easy to miss.
    const blanks = [];
    for (const termKey of ['midterm', 'final']) {
      for (const a of row[termKey].assessments) {
        if (a.raw === null || a.raw === undefined) blanks.push(a.assessment.name);
      }
    }
    if (blanks.length) {
      issues.push({
        severity: 'info',
        kind: 'blank_scores',
        student: row.student,
        message: `${who} has ${blanks.length} blank score${blanks.length > 1 ? 's' : ''} (${blanks.join(', ')}), each counting as 50.`,
      });
    }
  }

  // Students sitting in without being on the official roster. This is the
  // reminder the instructor asked for: it appears every time they check the
  // course, until the addendum arrives and they clear the flag.
  const offRoster = result.students.filter((r) => r.student.unofficial);
  for (const row of offRoster) {
    const who = row.student.full_name || `Student ${row.student.number ?? row.student.id}`;
    issues.push({
      severity: 'warning',
      kind: 'not_on_roster',
      student: row.student,
      message:
        `${who} is not on the official roster yet` +
        `${row.student.note ? ` (${row.student.note})` : ''}. ` +
        'Chase the addendum, then clear the flag on the Roster screen.',
    });
  }

  // One line for all the empty roster rows, rather than one line each.
  if (blankRows.length) {
    issues.push({
      severity: 'warning',
      kind: 'blank_roster_row',
      message:
        `${blankRows.length} empty roster row${blankRows.length === 1 ? '' : 's'} ` +
        `will export as blank. Fill them in or remove them.`,
    });
  }

  const rank = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return issues;
}

module.exports = { computeCourse, reviewIssues, formatGrade };
