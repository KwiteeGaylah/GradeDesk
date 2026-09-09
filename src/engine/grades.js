'use strict';
/**
 * The grade engine — pure functions implementing Appendix A of the PRD.
 *
 * Verified contract (reproduces the instructor's real workbook exactly):
 *   transmute(raw)      snap-down lookup; blank -> 50
 *   class_standing      average(transmuted class-standing scores) * 0.60
 *   term_total          class_standing + transmuted_exam * 0.40
 *   final_grade         midterm_total * 0.40 + final_total * 0.60
 *   letter              A>=90 B>=80 C>=70 D>=60 else F
 *                       "I"  if either exam raw is blank
 *                       "NG" if the final grade cannot be computed
 *
 * There are NO per-assessment weights. Every class-standing assessment counts
 * equally. The exam is always out of 40 and is weighted 40%, never averaged in.
 *
 * Zero UI dependencies. Zero I/O. Tables are injected by the caller.
 */

const { isBlank } = require('./transmutation');

/** The exam's point maximum is fixed by university policy. Not configurable. */
const EXAM_MAX_POINTS = 40;

/** Weight of the class-standing average within a term. */
const CLASS_STANDING_WEIGHT = 0.6;
/** Weight of the transmuted exam within a term. */
const EXAM_WEIGHT = 0.4;
/** Weights of each term within the final grade. */
const MIDTERM_WEIGHT = 0.4;
const FINAL_TERM_WEIGHT = 0.6;

/**
 * Attendance raw score, auto-computed from session marks.
 *   points * (count_P + 0.5 * count_E) / count_of_marked_sessions
 *
 * "P" = present (full), "E" = excused (half), any other non-blank mark = 0.
 * A BLANK mark means the session was not taken for that student and is
 * EXCLUDED from the denominator. The denominator is sessions actually marked,
 * not the planned total, so attendance is fair mid-term.
 *
 * @param {Array<string|null|undefined>} sessionMarks
 * @param {number} points  the attendance assessment's point maximum
 * @returns {number|null}  raw score, or null when nothing has been marked yet
 */
function attendanceRaw(sessionMarks, points) {
  const marks = Array.isArray(sessionMarks) ? sessionMarks : [];
  const marked = marks.filter((m) => !isBlank(m));
  if (marked.length === 0) return null; // nothing taken yet -> blank
  let credit = 0;
  for (const m of marked) {
    const code = String(m).trim().toUpperCase();
    if (code === 'P') credit += 1;
    else if (code === 'E') credit += 0.5;
    // anything else counts as zero
  }
  const exact = (points * credit) / marked.length;
  // Attendance is recorded as a whole number of points, matching the
  // instructor's workbook, where the column only ever holds 0, 5 or 10. The
  // division above can produce 9.166666..., which is neither how they record it
  // nor readable in a cell, so it is rounded to the nearest point. Half rounds
  // up, in the student's favour.
  return Math.round(exact);
}

/**
 * The unrounded attendance score, kept for display where the working matters
 * (a tooltip explaining how the rounded number was reached).
 */
function attendanceRawExact(sessionMarks, points) {
  const marks = Array.isArray(sessionMarks) ? sessionMarks : [];
  const marked = marks.filter((m) => !isBlank(m));
  if (marked.length === 0) return null;
  let credit = 0;
  for (const m of marked) {
    const code = String(m).trim().toUpperCase();
    if (code === 'P') credit += 1;
    else if (code === 'E') credit += 0.5;
  }
  return (points * credit) / marked.length;
}

/**
 * Class standing for one term.
 * @param {Array<{raw:*, maxPoints:number}>} assessments  class-standing only, no exam
 * @param {TransmutationTables} tables
 * @param {string|number} policy
 * @returns {number|null} null when the term has no class-standing assessments
 */
function classStanding(assessments, tables, policy) {
  const list = Array.isArray(assessments) ? assessments : [];
  if (list.length === 0) return null;
  let sum = 0;
  for (const a of list) {
    sum += tables.transmute(a.raw, a.maxPoints, policy);
  }
  return (sum / list.length) * CLASS_STANDING_WEIGHT;
}

/**
 * Term total = class standing + transmuted exam * 0.40.
 *
 * A blank exam still transmutes to 50 and contributes here — the term total is
 * computable. It is the LETTER that becomes "I". These are different rules.
 *
 * @returns {number|null} null when class standing is unavailable
 */
function termTotal(assessments, examRaw, tables, policy) {
  const cs = classStanding(assessments, tables, policy);
  if (cs === null) return null;
  const examTransmuted = tables.transmute(examRaw, EXAM_MAX_POINTS, policy);
  return cs + examTransmuted * EXAM_WEIGHT;
}

/**
 * Final grade = midterm_total * 0.40 + final_total * 0.60.
 * @returns {number|null} null when either term total is unavailable
 */
function finalGrade(midtermTotal, finalTotal) {
  if (midtermTotal === null || midtermTotal === undefined) return null;
  if (finalTotal === null || finalTotal === undefined) return null;
  if (!Number.isFinite(midtermTotal) || !Number.isFinite(finalTotal)) return null;
  return midtermTotal * MIDTERM_WEIGHT + finalTotal * FINAL_TERM_WEIGHT;
}

/**
 * Letter grade.
 * "I" takes precedence over everything: a blank midterm OR final exam raw score
 * means Incomplete regardless of the computed number.
 */
function letterGrade(grade, midtermExamRaw, finalExamRaw) {
  if (isBlank(midtermExamRaw) || isBlank(finalExamRaw)) return 'I';
  if (grade === null || grade === undefined || !Number.isFinite(grade)) return 'NG';
  if (grade >= 90) return 'A';
  if (grade >= 80) return 'B';
  if (grade >= 70) return 'C';
  if (grade >= 60) return 'D';
  return 'F';
}

/**
 * Format a grade to two decimals with NO rounding — truncation toward zero.
 * A deliberate product decision: the displayed value is the computed value,
 * never nudged across a letter boundary. 89.999 shows as 89.99, not 90.00.
 *
 * Floating-point guard: a value that is a hair below an exact hundredth purely
 * because of binary representation (83.02 arriving as 83.019999999999996)
 * must still display as 83.02, not 83.01. The epsilon below is far smaller
 * than any real grade difference, so it cannot mask a genuine value.
 *
 * @param {number|null} grade
 * @returns {string} e.g. "82.18", or "" when there is no grade
 */
function formatGrade(grade) {
  if (grade === null || grade === undefined || !Number.isFinite(grade)) return '';
  const scaled = grade * 100;
  const eps = Math.max(Math.abs(scaled), 1) * Number.EPSILON * 8;
  const truncated = Math.trunc(scaled + Math.sign(scaled) * eps) / 100;
  return truncated.toFixed(2);
}

/**
 * Compute one student's full result from their raw scores.
 *
 * @param {object} input
 * @param {Array<{raw:*, maxPoints:number}>} input.midtermAssessments class standing only
 * @param {*} input.midtermExamRaw
 * @param {Array<{raw:*, maxPoints:number}>} input.finalAssessments class standing only
 * @param {*} input.finalExamRaw
 * @param {TransmutationTables} tables
 * @param {string|number} policy
 */
function computeStudent(input, tables, policy) {
  const {
    midtermAssessments = [],
    midtermExamRaw = null,
    finalAssessments = [],
    finalExamRaw = null,
  } = input || {};

  const midtermClassStanding = classStanding(midtermAssessments, tables, policy);
  const finalClassStanding = classStanding(finalAssessments, tables, policy);
  const midtermExamTransmuted = tables.transmute(midtermExamRaw, EXAM_MAX_POINTS, policy);
  const finalExamTransmuted = tables.transmute(finalExamRaw, EXAM_MAX_POINTS, policy);

  const midtermTotal =
    midtermClassStanding === null
      ? null
      : midtermClassStanding + midtermExamTransmuted * EXAM_WEIGHT;
  const finalTotal =
    finalClassStanding === null ? null : finalClassStanding + finalExamTransmuted * EXAM_WEIGHT;

  const grade = finalGrade(midtermTotal, finalTotal);
  const letter = letterGrade(grade, midtermExamRaw, finalExamRaw);

  return {
    midtermTransmuted: midtermAssessments.map((a) => tables.transmute(a.raw, a.maxPoints, policy)),
    finalTransmuted: finalAssessments.map((a) => tables.transmute(a.raw, a.maxPoints, policy)),
    midtermClassStanding,
    finalClassStanding,
    midtermExamTransmuted,
    finalExamTransmuted,
    midtermTotal,
    finalTotal,
    finalGrade: grade,
    finalGradeDisplay: formatGrade(grade),
    letter,
  };
}

module.exports = {
  EXAM_MAX_POINTS,
  CLASS_STANDING_WEIGHT,
  EXAM_WEIGHT,
  MIDTERM_WEIGHT,
  FINAL_TERM_WEIGHT,
  attendanceRaw,
  attendanceRawExact,
  classStanding,
  termTotal,
  finalGrade,
  letterGrade,
  formatGrade,
  computeStudent,
};
