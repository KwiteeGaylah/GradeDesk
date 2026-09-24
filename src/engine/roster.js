'use strict';
/**
 * Roster paste parsing and student name handling.
 *
 * Lives beside the engine because it is pure text handling with no UI or I/O,
 * which lets it be tested directly rather than scraped out of the renderer.
 *
 * THE ADMINISTRATION'S FORMAT
 * ---------------------------
 * The official class list handed to instructors has four columns, in this
 * order, and the paste box is built around it so a list can go straight from
 * the administration's file into GradeDesk without being retyped:
 *
 *     Student ID | Last Name | First Name | Middle Name
 *
 * A row pasted out of Excel arrives tab-separated, which is unambiguous, so
 * that is the format the parser trusts first and the sample workbook teaches.
 *
 * WHY THE OTHER RULES STILL EXIST
 * -------------------------------
 * Version 1 accepted "ID<tab>Surname, Given" and instructors have lists typed
 * that way. Those still parse, because refusing them would strand real work.
 * Names here are written "Surname, Given", so a comma is part of the name far
 * more often than it is a separator; splitting on commas indiscriminately
 * turns "Bestman, Comfort K." into "Bestman Comfort K." for every pasted row,
 * which is why the legacy rules below stay deliberately conservative.
 */

/** Columns of the official list, in the order the administration prints them. */
const ROSTER_COLUMNS = ['Student ID', 'Last Name', 'First Name', 'Middle Name'];

/** Collapse runs of whitespace and trim. */
function tidy(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the display name from its parts: "Last, First Middle".
 *
 * This is the single definition of how a name reads, used by the roster grid,
 * every screen and all three exported sheets, so a name can never be spelled
 * one way on screen and another in the workbook.
 *
 * Any part may be missing, and the punctuation adapts rather than leaving a
 * stray comma behind: last name alone is just the last name, and a student
 * with only a first name reads as that first name.
 */
function joinName({ lastName = '', firstName = '', middleName = '' } = {}) {
  const last = tidy(lastName);
  const given = [tidy(firstName), tidy(middleName)].filter(Boolean).join(' ');
  if (last && given) return `${last}, ${given}`;
  return last || given;
}

/**
 * Split a written name into parts — the reverse of joinName.
 *
 * Used when upgrading a version 1 database, where only the joined name was
 * ever stored, and when an instructor types a whole name into a single box.
 *
 *   "Bestman, Comfort K."  -> Bestman / Comfort / K.
 *   "Bestman, Comfort"     -> Bestman / Comfort /
 *   "Bestman Comfort"      -> Bestman / Comfort /        (first word is surname)
 *   "Bestman"              -> Bestman /         /
 *
 * The comma form is authoritative: everything before the comma is the surname,
 * however many words it runs to, so "Van Der Berg, Anna" survives. Without a
 * comma the FIRST word is taken as the surname, matching the column order of
 * the official list. That guess is why the original string is kept in the
 * database rather than discarded — see the migration in data/store.js.
 */
function splitName(fullName) {
  const text = tidy(fullName);
  if (!text) return { lastName: '', firstName: '', middleName: '' };

  const comma = text.indexOf(',');
  if (comma !== -1) {
    const last = tidy(text.slice(0, comma));
    const given = tidy(text.slice(comma + 1)).split(' ').filter(Boolean);
    return {
      lastName: last,
      firstName: given[0] || '',
      // Everything after the first given name is the middle name, so a double
      // middle name stays whole instead of being silently dropped.
      middleName: given.slice(1).join(' '),
    };
  }

  // No comma. The administration writes surname first, and so does every list
  // pasted in this order, so the FIRST word is the surname. Reading it the
  // other way round ("First Last") would sort the whole class by given name
  // while looking correct on screen, which is the kind of error nobody
  // notices until grades are submitted.
  const words = text.split(' ').filter(Boolean);
  if (words.length === 1) return { lastName: words[0], firstName: '', middleName: '' };
  return {
    lastName: words[0],
    firstName: words[1],
    middleName: words.slice(2).join(' '),
  };
}

/** True when a cell looks like an ID: has a digit and no spaces. */
function looksLikeId(text) {
  const t = tidy(text);
  return t !== '' && /\d/.test(t) && !/\s/.test(t);
}

/**
 * True when a line is the header row of the administration's list, so pasting
 * the sheet complete with its headings does not create a student called
 * "Last Name".
 */
function isHeaderLine(line) {
  const cells = String(line).split(/\t|\s{2,}|,/).map((c) => tidy(c).toLowerCase()).filter(Boolean);
  if (!cells.length) return false;
  const known = new Set([
    'student id', 'studentid', 'id', 'id number', 'id no', 'id no.', 'no', 'no.', '#',
    'last name', 'lastname', 'surname', 'family name',
    'first name', 'firstname', 'given name', 'given',
    'middle name', 'middlename', 'middle', 'middle initial', 'mi',
    'full name', 'fullname', 'name', 'student name',
  ]);
  // Every cell has to be a heading. One real name in the row means it is data.
  return cells.every((c) => known.has(c));
}

/**
 * Parse one pasted roster line into an ID and name parts.
 *
 * The administration's four-column format, tab or multi-space separated:
 *   "10001\tBestman\tComfort\tK."   -> 10001 / Bestman / Comfort / K.
 *   "10001\tBestman\tComfort"       -> 10001 / Bestman / Comfort /
 *
 * Still accepted, from version 1 and from hand-typed lists:
 *   "10001\tBestman, Comfort K."    -> 10001 / Bestman / Comfort / K.
 *   "10001, Bestman, Comfort K."    -> 10001 / Bestman / Comfort / K.
 *   "Bestman, Comfort K."           ->       / Bestman / Comfort / K.
 *   "Freeman Mercy"                 ->       / Freeman / Mercy   /   (surname first)
 *
 * @param {string} line
 * @returns {{studentId: string, lastName: string, firstName: string,
 *            middleName: string, fullName: string}}
 */
function parseRosterLine(line) {
  const text = String(line);

  const done = (studentId, lastName, firstName, middleName) => {
    const parts = {
      studentId: tidy(studentId),
      lastName: tidy(lastName),
      firstName: tidy(firstName),
      middleName: tidy(middleName),
    };
    return { ...parts, fullName: joinName(parts) };
  };

  // splitName's result, spread into done()'s positional arguments by name
  // rather than by key order, so reordering that object cannot silently swap
  // a student's first and last name.
  const written = (studentId, name) => {
    const n = splitName(name);
    return done(studentId, n.lastName, n.firstName, n.middleName);
  };

  // Split into columns on tabs, or on runs of two-or-more spaces, which is what
  // someone types when they mean a tab. A single space is NOT a column break:
  // it is far more likely to be inside a name.
  //
  // The line is trimmed FIRST: a leading space would otherwise open the row
  // with an empty column and push the ID into the surname's place.
  const columns = text.trim().split(/\t|\s{2,}/).map((c) => c.trim());
  const filled = columns.filter((c) => c !== '');

  if (filled.length >= 2) {
    // Columns as the administration prints them: ID, Last, First, Middle.
    if (looksLikeId(filled[0])) {
      const [id, ...cells] = filled;
      // A single remaining cell is a whole name in one column, not a surname:
      // "10001<tab>Bestman, Comfort K." is the version 1 format.
      if (cells.length === 1) return written(id, cells[0]);
      return done(id, cells[0], cells[1], cells.slice(2).join(' '));
    }
    // No ID, but still columns: Last, First, Middle.
    if (filled.length === 1) return written('', filled[0]);
    return done('', filled[0], filled[1], filled.slice(2).join(' '));
  }

  // One column only. Fall back to the version 1 comma rules.
  //
  // Split on the FIRST comma, and only when the text before it looks like an
  // identifier rather than a surname. Any later commas belong to the name.
  const comma = text.indexOf(',');
  if (comma !== -1) {
    const head = text.slice(0, comma).trim();
    const rest = text.slice(comma + 1).trim();
    if (looksLikeId(head)) {
      // "10001, Bestman, Comfort K." — the rest is a written name, but it can
      // equally be "10001, Bestman, Comfort, K." with every column comma'd.
      const cells = rest.split(',').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        // "10001, Bestman, Comfort K." has the given names in one cell, while
        // "10001, Bestman, Comfort, K." has them in two. Both must land the
        // same way, so a two-cell tail is split on its spaces.
        if (cells.length === 2) {
          const given = cells[1].split(' ').filter(Boolean);
          return done(head, cells[0], given[0] || '', given.slice(1).join(' '));
        }
        return done(head, cells[0], cells[1], cells.slice(2).join(' '));
      }
      return written(head, rest);
    }
  }

  // A single space between an ID-looking head and the rest. This is the case
  // that silently produced a student named "10001 Bestman Comfort K." with no
  // ID at all in version 1, which then made every computed column blank.
  const spaced = /^(\S+)\s+(\S.*)$/.exec(text.trim());
  if (spaced && looksLikeId(spaced[1])) {
    return written(spaced[1], spaced[2]);
  }

  // No usable separator: the whole line is a name, commas included.
  return written('', text);
}

/**
 * Parse a pasted block into roster rows, skipping blank lines and a header row
 * copied along with the data.
 */
function parseRosterText(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .filter((line) => !isHeaderLine(line))
    .map(parseRosterLine);
}

module.exports = {
  ROSTER_COLUMNS,
  parseRosterLine,
  parseRosterText,
  joinName,
  splitName,
  isHeaderLine,
};
