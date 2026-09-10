'use strict';
/**
 * Date formatting, shared by the screens, the exports and the file names.
 *
 * Dates are stored as YYYY-MM-DD because that sorts correctly and is
 * unambiguous. They are never shown that way: an instructor reads
 * "Sept. 9, 2026", so every place a date reaches a person goes through here.
 */

const MONTHS_SHORT = [
  'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
  'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.',
];

/** Split a stored YYYY-MM-DD into parts, or null if it is not one. */
function parseStored(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * "2026-09-09" becomes "Sept. 9, 2026".
 * Anything that is not a stored date is returned unchanged, so a half-typed
 * value still shows what the instructor typed rather than disappearing.
 */
function formatDate(value) {
  const p = parseStored(value);
  if (!p) return String(value || '');
  return `${MONTHS_SHORT[p.month - 1]} ${p.day}, ${p.year}`;
}

/**
 * A shorter form for a column header, where the year is usually obvious from
 * the semester: "Sept. 9". Pass the whole list so the year is kept when a term
 * happens to straddle two of them.
 */
function formatDateShort(value, allValues = []) {
  const p = parseStored(value);
  if (!p) return String(value || '');
  const years = new Set(
    allValues.map(parseStored).filter(Boolean).map((d) => d.year)
  );
  const needsYear = years.size > 1 || years.size === 0;
  return needsYear
    ? `${MONTHS_SHORT[p.month - 1]} ${p.day}, ${p.year}`
    : `${MONTHS_SHORT[p.month - 1]} ${p.day}`;
}

/** Today as a stored date, for defaulting a date picker. */
function todayStored(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A date safe to put in a file name: "2026-09-09" becomes "Sept 9 2026".
 * No commas or dots, since those read badly in a file name and the dot would
 * look like a second extension.
 */
function formatDateForFilename(value) {
  const p = parseStored(value) || parseStored(todayStored(new Date(value)));
  if (!p) return '';
  return `${MONTHS_SHORT[p.month - 1].replace('.', '')} ${p.day} ${p.year}`;
}

module.exports = {
  MONTHS_SHORT,
  formatDate,
  formatDateShort,
  formatDateForFilename,
  todayStored,
};
