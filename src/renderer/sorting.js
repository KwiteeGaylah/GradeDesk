'use strict';
/**
 * One definition of how a class list is sorted, shared by every screen.
 *
 * Grade entry, the roster and attendance each used to build their own sorter
 * list, which meant the same class could be in three different orders
 * depending on which screen you were looking at, and attendance had no sort at
 * all. Marking a column on one screen against a list ordered differently on
 * another is exactly how a mark lands on the wrong student.
 *
 * So the options live here, once. A screen asks for the options it can
 * support: every screen has names and IDs, only grade entry has a score in the
 * current column, and only grade entry has a final grade to sort by. The
 * shared options keep the same wording and the same order everywhere they
 * appear, so the list reads the same wherever you are.
 *
 * DEFAULT: surname. That is the order the administration's list arrives in and
 * the order every submitted document uses, so it is what an instructor is
 * comparing against while they type.
 */

/** The sort every screen opens on. */
const DEFAULT_SORT = 'last';

/**
 * Options every screen offers, in the order they appear in the menu.
 *
 * `roster` is the instructor's own hand-arranged order, so it stays at the top
 * as the way back to "however I left it".
 */
const COMMON_SORTS = [
  ['roster', 'Roster order'],
  ['last', 'Last name (A–Z)'],
  ['last-desc', 'Last name (Z–A)'],
  ['first', 'First name (A–Z)'],
  ['first-desc', 'First name (Z–A)'],
  ['id', 'Student ID'],
];

/** Offered only where there is a score in the current column. */
const SCORE_SORTS = [
  ['raw-desc', 'This score, high to low'],
  ['raw-asc', 'This score, low to high'],
  ['blank', 'Blanks first'],
];

/** Offered only where a computed final grade is on screen. */
const GRADE_SORTS = [
  ['grade-desc', 'Final grade, high to low'],
  ['grade-asc', 'Final grade, low to high'],
  ['letter', 'Letter grade'],
];

/** Offered only on the roster, where a row can be half-filled. */
const ROSTER_SORTS = [['incomplete', 'Incomplete rows first']];

/**
 * The option list for one screen.
 *
 * @param {{score?: boolean, grade?: boolean, roster?: boolean}} features
 * @returns {Array<[string, string]>} [value, label] pairs
 */
function sortOptions(features = {}) {
  return [
    ...COMMON_SORTS,
    ...(features.score ? SCORE_SORTS : []),
    ...(features.grade ? GRADE_SORTS : []),
    ...(features.roster ? ROSTER_SORTS : []),
  ];
}

/** Compare two strings the way a name list should read, case-insensitively. */
function byText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

/**
 * A name part, falling back to the written name when the parts are empty.
 *
 * A student typed into version 1 and never edited since has a full_name but no
 * parts until the migration splits them. This keeps such a row sorting sensibly
 * instead of sinking to the bottom as an empty string.
 */
function namePart(student, part) {
  const value = String((student && student[part]) || '').trim();
  if (value) return value;
  const whole = String((student && student.full_name) || '').trim();
  if (!whole) return '';
  // Mirror splitName's reading without importing it: surname first, or
  // everything before a comma.
  const comma = whole.indexOf(',');
  if (part === 'last_name') return comma === -1 ? whole.split(/\s+/)[0] : whole.slice(0, comma).trim();
  if (part === 'first_name') {
    const given = comma === -1 ? whole.split(/\s+/).slice(1) : whole.slice(comma + 1).trim().split(/\s+/);
    return given[0] || '';
  }
  return '';
}

/**
 * Build the comparator for one sort value.
 *
 * @param {string} sort  a value from sortOptions
 * @param {object} accessors
 * @param {(row:any) => object} accessors.student  the student record on a row
 * @param {(row:any) => number|null} [accessors.raw]     score in the current column
 * @param {(row:any) => number|null} [accessors.grade]   computed final grade
 * @param {(row:any) => string} [accessors.letter]       computed letter
 * @returns {(a:any, b:any) => number}
 */
function comparator(sort, accessors) {
  const student = accessors.student || ((row) => row);
  const raw = accessors.raw || (() => null);
  const grade = accessors.grade || (() => null);
  const letter = accessors.letter || (() => '');

  // The instructor's own order, and the tiebreak for every other sort, so a
  // sorted list never shuffles between renders.
  const byOrder = (a, b) => {
    const sa = student(a);
    const sb = student(b);
    return (
      (sa.sort_order ?? sa.number ?? 0) - (sb.sort_order ?? sb.number ?? 0) ||
      (sa.id ?? 0) - (sb.id ?? 0)
    );
  };

  // A missing value always sinks to the bottom, whichever way the sort runs,
  // so blanks never masquerade as the lowest score.
  const nullsLast = (a, b, dir) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return dir * (a - b);
  };

  const byLast = (a, b) =>
    byText(namePart(student(a), 'last_name'), namePart(student(b), 'last_name')) ||
    byText(namePart(student(a), 'first_name'), namePart(student(b), 'first_name')) ||
    byOrder(a, b);

  const byFirst = (a, b) =>
    byText(namePart(student(a), 'first_name'), namePart(student(b), 'first_name')) ||
    byText(namePart(student(a), 'last_name'), namePart(student(b), 'last_name')) ||
    byOrder(a, b);

  const incomplete = (s) =>
    !String(s.full_name || '').trim() || !String(s.student_id || '').trim();

  const LETTERS = ['A', 'B', 'C', 'D', 'F', 'I', 'NG'];

  const sorters = {
    roster: byOrder,
    last: byLast,
    'last-desc': (a, b) => -byLast(a, b),
    first: byFirst,
    'first-desc': (a, b) => -byFirst(a, b),
    id: (a, b) =>
      String(student(a).student_id || '').localeCompare(
        String(student(b).student_id || ''), undefined, { numeric: true }
      ) || byOrder(a, b),
    'raw-desc': (a, b) => nullsLast(raw(a), raw(b), -1) || byOrder(a, b),
    'raw-asc': (a, b) => nullsLast(raw(a), raw(b), 1) || byOrder(a, b),
    blank: (a, b) => (raw(a) === null ? 0 : 1) - (raw(b) === null ? 0 : 1) || byOrder(a, b),
    'grade-desc': (a, b) => nullsLast(grade(a), grade(b), -1) || byOrder(a, b),
    'grade-asc': (a, b) => nullsLast(grade(a), grade(b), 1) || byOrder(a, b),
    letter: (a, b) => LETTERS.indexOf(letter(a)) - LETTERS.indexOf(letter(b)) || byOrder(a, b),
    incomplete: (a, b) =>
      (incomplete(student(a)) ? 0 : 1) - (incomplete(student(b)) ? 0 : 1) || byOrder(a, b),
  };

  return sorters[sort] || sorters[DEFAULT_SORT];
}

/** Sort a copy of `rows`, leaving the caller's array alone. */
function sortRows(rows, sort, accessors) {
  return [...rows].sort(comparator(sort, accessors));
}

window.GradeDeskSorting = {
  DEFAULT_SORT,
  sortOptions,
  comparator,
  sortRows,
  namePart,
};
