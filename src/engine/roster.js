'use strict';
/**
 * Roster paste parsing.
 *
 * Lives beside the engine because it is pure text handling with no UI or I/O,
 * which lets it be tested directly rather than scraped out of the renderer.
 *
 * WVSTU names are written "Surname, Given", so a comma is part of the name far
 * more often than it is a separator. Splitting on commas indiscriminately
 * turns "Bestman, Comfort K." into "Bestman Comfort K." for every pasted
 * row, which is why the rules below are deliberately conservative.
 */

/**
 * Parse one pasted roster line into an ID and a name.
 *
 *   "10001\tBestman, Comfort K."  -> 44305 / "Bestman, Comfort K."
 *   "44305, Bestman, Comfort K."  -> 44305 / "Bestman, Comfort K."
 *   "Bestman, Comfort K."         ->       / "Bestman, Comfort K."
 *   "Nagbe, S, Jonathan T."        ->       / "Nagbe, S, Jonathan T."
 *   "Freeman Mercy"                ->       / "Freeman Mercy"
 *
 * @param {string} line
 * @returns {{studentId: string, fullName: string}}
 */
function parseRosterLine(line) {
  const text = String(line);

  // A tab is unambiguous: everything before it is the ID.
  const tab = text.indexOf('\t');
  if (tab !== -1) {
    return { studentId: text.slice(0, tab).trim(), fullName: text.slice(tab + 1).trim() };
  }

  // Otherwise split on the FIRST comma only, and only when the text before it
  // looks like an identifier rather than a surname: it contains a digit and no
  // spaces. Any later commas belong to the name.
  const comma = text.indexOf(',');
  if (comma !== -1) {
    const head = text.slice(0, comma).trim();
    const rest = text.slice(comma + 1).trim();
    if (/\d/.test(head) && !/\s/.test(head)) {
      return { studentId: head, fullName: rest };
    }
  }

  // No usable separator: the whole line is a name, commas included.
  return { studentId: '', fullName: text.trim() };
}

/** Parse a pasted block into roster rows, skipping blank lines. */
function parseRosterText(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseRosterLine);
}

module.exports = { parseRosterLine, parseRosterText };
